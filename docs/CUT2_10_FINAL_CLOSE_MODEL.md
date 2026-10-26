# CUT2-10A — Modelo canónico propuesto de cierre final

## Propósito y límite

Este es el contrato de diseño para CUT2-10B. No está implementado en CUT2-10A.
Su objetivo es reemplazar la **decisión** del cierre legacy por una decisión
integral, conservando `public.close_inventory` hasta que el nuevo escritor
esté certificado. No crea ERP, ajusta stock ni emite XLSX.

## Autoridad única

Nombre propuesto: `app_private.inventory_close_readiness`.

Entrada propuesta:

```text
(p_inventory_id uuid, p_actor_id uuid default auth.uid())
```

Salida mínima y estable:

```json
{
  "inventory_id": "uuid",
  "warehouse_id": "uuid",
  "eligible": false,
  "fingerprint": "sha256",
  "as_of": "timestamptz",
  "blockers": [
    {"code": "OPEN_RECOUNT_MISSION", "blocks_close": true,
     "count": 2, "resource_ids": ["uuid"]}
  ],
  "summary": {
    "c1_completed": true,
    "open_reconciliation_cases": 0,
    "open_recount_missions": 2,
    "close_blocking_findings": 0,
    "rp_eligible_unreleased": 4,
    "rp_drafts": 0
  }
}
```

El fingerprint debe serializar determinísticamente estado lifecycle, versión o
ids de C1/reconciliación, misiones no terminales, findings bloqueantes,
identidades selladas, UOM/huérfanos, release READY/DRAFT y cadena de
rectificación/descartes. El fingerprint no sustituye locks: es detección de
stale preview y evidencia de la decisión.

La función compone, sin duplicar, estas autoridades existentes:

1. `inventories`, `inventory_freeze_guards`, `reconciliation_cases` y
   `recount_missions`.
2. `rolling_cut_requests` e `inventory_sealed_references`.
3. `reference_findings`, `finding_evidence`, `reference_finding_events` y los
   contratos CUT2-08 de `blocks_close`/`blocks_rp`.
4. `orphan_references`, `uom_resolution_cases` y la identidad de CUT2-01.
5. `app_private.rp_release_eligibility`, `rp_release_batches`, auditorías,
   eventos, descartes y rectificaciones.
6. `inventory_close_requests` / `inventory_close_backups` ya existentes.

## Contrato de preview y cierre propuesto

`public.preview_inventory_close(p_inventory_id)`:

- exige actor activo, `CLOSE_INVENTORY`, inventario y bodega scoped;
- devuelve la salida de readiness; no crea filas, backup, release ni evento;
- es la única fuente de UI para el paso “cierre final”.

`public.request_inventory_close(p_inventory_id, p_expected_fingerprint,
p_request_id)`:

1. exige los mismos controles y un `request_id` válido;
2. toma locks `inventory → close request idempotente → conjuntos materiales`;
3. reconstruye readiness bajo esos locks;
4. responde `PREVIEW_STALE` si el fingerprint cambió;
5. responde `INVENTORY_CLOSE_BLOCKED` con códigos seguros si hay blocker;
6. reutiliza el resultado del mismo request cuando la huella coincide y
   rechaza `IDEMPOTENCY_CONFLICT` si no;
7. sólo entonces registra la request/auditoría y realiza la transición
   `ABIERTO → CERRADO` mediante la autoridad de transición existente.

La transición no debe aceptar una lista de recursos decidida por el cliente.
La preview sirve para experiencia; la revalidación transaccional es autoridad.

## Política de RP y releases múltiples

- El universo de cierre es toda referencia `SEALED` de la bodega del
  inventario, con identidad LEGACY/SKU, PARTIDA/SKU+lote o SERIAL/SKU+serie.
- Cada referencia elegible está presente una vez en un snapshot `READY`
  vigente, o está cubierta por una acción canónica de descarte/rectificación.
- Un `DRAFT`, `BLOCKED` o `INTEGRITY_FAILURE` no se ignora. Bloquea, porque
  existe una intención de release no finalizada o corrupta.
- Varios releases son válidos sólo como historial de cadena: la autoridad debe
  identificar el `READY` vigente por referencia y validar que los
  `SUPERSEDED` estén unidos mediante `rp_release_rectifications`.
- Una referencia elegible no liberada es `RP_REFERENCE_OMITTED`; bloquea.
- Que un release sea `READY` no ejecuta ERP. Su manifiesto es evidencia local
  de release preparada; XLSX/export se muestra como metadato, no como nueva
  mutación del cierre.

## Autorización y alcance

`CLOSE_INVENTORY` ya está en el catálogo de capabilities y en la política por
defecto de `ANALISTA/PERMANENT` (inventory) y `ADMIN/PERMANENT` (global).
CUT2-10B debe usar `app_private.require_inventory_capability`, que incorpora
actor activo, user type, asignación vigente, grants y scope de bodega. No debe
usar role-only ni el legacy `can_manage_inventory` como autoridad suficiente.

El modelo actual asocia cada `inventory_id` a una sola `warehouse_id`. Si se
evoluciona a inventario multi-bodega, el close global debe exigir capability
para cada bodega del conjunto y fallar cerrado si el actor sólo cubre una
parte. Nunca debe filtrar la mitad inaccesible y declarar elegible el total.

## Offline, inmovilidad y auditoría

El cierre no puede originarse offline. Las colas/outbox que lleguen luego se
procesan con autoridad actual: una captura que ya no sea válida preserva su
evidencia/review (`REFERENCE_SEALED`, `AUTHORIZATION_REVOKED` o
`STALE_ASSIGNMENT`) y bloquea si esa revisión afecta el cierre. La client cache
no es evidencia de que la cola esté vacía.

Después de cerrar, no se mutan C1, sellos, findings/evidence, C2/C3 o releases
por rutas ordinarias. La trazabilidad se conserva en `audit_events`, requests
de cierre, backups, auditorías RP y eventos de findings/reconciliación. Una
reapertura —si alguna vez se autoriza— debe ser una transición administrativa
nueva, con motivo, fingerprint, auditoría y tests propios; no se diseña ni se
implementa en CUT2-10B inicial.

## Plan de pruebas CUT2-10B

### pgTAP conductual

- lifecycle: no ABIERTO, C1 no finalizado, sync guard y casos/misiones abiertos;
- matriz de findings (`blocks_close`, `blocks_rp`, `OPEN`/`HELD` frente a
  resuelto/descartado);
- unsealed/held/orphan/UOM/identidad; aislamiento SKU/partida/serie;
- RP: elegible omitida, `DRAFT`, `READY`, integrity failure, supersession,
  descarte/rectificación;
- scope inventory/bodega, actor inactivo, capability ausente y anon;
- preview stale, idempotencia, doble close y close contra cambio material;
- no ERP/no ajuste/no modificación de C1/C2/C3/findings/RP snapshot;
- post-close: las mutaciones físicas normales son denegadas y auditoría única.

### Carreras PostgreSQL reales

Usar dos conexiones con barrera, no sleeps:

1. close vs nueva evidencia/findings/UOM: el cambio antes del lock invalida
   preview; después se confirma tras snapshot/close, sin mutar historia;
2. close vs C2/C3 claim/complete: un único orden `inventory → recurso` evita
   deadlock y la segunda operación observa estado válido;
3. close vs `create_rp_release`/`mark_rp_release_ready`: no existe release
   parcial ni close con DRAFT oculto;
4. close vs close mismo/diferente request: una transición/auditoría, respuesta
   idempotente para mismo request y conflicto controlado para otro.

### Cliente y E2E

- panel de supervisión muestra preview scoped, conteos de blocker y huella;
- botón sólo para `CLOSE_INVENTORY`, pero RPC vuelve a validar;
- estados loading/error/stale/blocker/ready/idempotent; no datos de otra bodega;
- intento offline queda bloqueado sin crear close local;
- Chromium: happy path, cada blocker de alto riesgo, acceso directo denegado,
  stale entre preview/request y auditoría de cierre.

### Rendimiento y seguridad

- dataset local con múltiples bodegas, referencias selladas, findings, C2/C3,
  UOM, huérfanos y releases; medir readiness, evidencia de omitidos y preview
  con `EXPLAIN (ANALYZE, BUFFERS)`;
- registrar planning/execution, rows, loops, buffers, scan e índices; añadir
  índices sólo por evidencia, sin duplicar los de sealed refs/findings/RP;
- toda RPC nueva: `SECURITY DEFINER`, `search_path` fijo, objetos calificados,
  `REVOKE PUBLIC`, grants mínimos, RLS y ataques directos a tablas/RPC.

## UI conceptual (no implementada)

El único punto de entrada debe ser el panel de lifecycle de Supervisión. Debe
ofrecer “Previsualizar cierre final”, resumen de blockers y vínculo a su fuente
(finding, misión, release o UOM), sin dashboard paralelo. La UI no decide
eligibilidad, no marca release READY y no aplica ERP.

## Criterio para iniciar CUT2-10B

Puede iniciar cuando se mantengan congelados CUT2-03 a CUT2-09 y se implemente
la autoridad descrita mediante cambios aditivos, tests de concurrencia reales y
validación local completa. No queda una decisión de negocio sin especificar:
para el modelo actual el cierre es por inventario+bodega, exige release `READY`
o cobertura auditable para toda referencia elegible, y no ejecuta ERP.

## Estado de implementación CUT2-10B

La migración `20261024200701_cut2_10b_inventory_close_core.sql` implementa
readiness, preview y close final siguiendo este contrato. El estado de
certificación, incluidos los comandos aún bloqueados por la infraestructura
local, se conserva en `CUT2_10_LOCAL_VALIDATION.md`; no debe confundirse la
existencia de la migración con la certificación del gate.

## Endurecimiento B3 local

La implementación confirma el orden efectivo `capability/scope → inventory
FOR UPDATE → request idempotente FOR UPDATE → readiness recomputada →
lifecycle/auditoría`. El writer pre-seal adquiere el mismo lock de inventario y
rechaza `INVENTORY_CLOSED`; por tanto no puede crear un hallazgo de C1 después
del cierre. La evidencia tardía no utiliza ese writer: conserva sus contratos
de intake y `REVIEW_REQUIRED` de CUT2-04/CUT2-08. Esta separación evita que un
hallazgo pre-seal tardío cambie el material de un cierre histórico.

## CUT2-10C — Capa operativa de cierre

El único punto de entrada visible es el panel **CIERRE DE INVENTARIO** dentro
del ciclo de vida de Supervisión. No calcula elegibilidad localmente: sólo
llama a `preview_inventory_close` y `close_inventory_final`. La preview
presenta estado actual/objetivo, huella resumida, actualización, cuentas de
C2/C3, findings, reviews, sellos, huérfanos y RP, y muestra los códigos de
bloqueo junto a una explicación operacional. Un cierre requiere una
confirmación explícita que deja claro que no ajusta ERP, no modifica stock, no
genera XLSX ni crea una liberación RP.

El writer continúa siendo la autoridad para capability, scope, fingerprint,
idempotencia, lifecycle y auditoría. El cliente genera sólo el `request_id` y
no envía una lista material de recursos. `PREVIEW_STALE` refresca la preview y
no hace retry automático; `INVENTORY_NOT_READY` repone blockers actuales y
`INVENTORY_ALREADY_CLOSED` bloquea el CTA y muestra el estado terminal. Un
guard síncrono de la interacción impide doble submit incluso antes de que React
publique el estado `closing`.

### Corrección crítica C10C

El writer B devolvía `PREVIEW_STALE` con SQLSTATE `40001`. Ese código significa
reintento de serialización para el gateway PostgREST local, por lo que una
previsualización obsoleta —que es un rechazo determinista de dominio— terminaba
en timeout HTTP y no podía llegar al usuario. La migración aditiva
`20261026100000_cut2_10c_preview_stale_http.sql` conserva exactamente los
locks, la revalidación, `SECURITY DEFINER`, `search_path` vacío y los grants
mínimos del escritor; sólo cambia ese error a `P0001`. El contrato pgTAP cubre
el nuevo código y Chromium valida ahora el mensaje de stale y la actualización
posterior.

La misma certificación detectó que el UUID legado de bodega aceptado por
PostgreSQL no cumplía el validador RFC estricto de Zod. El contrato de
transporte acepta ahora el formato UUID hexadecimal de PostgreSQL, sin relajar
ninguna autorización ni transformar identificadores del servidor.
