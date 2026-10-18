# CUT2-08 — validación local

## Estado

**Pre-freeze CUT2-08J5 en validación local.** CUT2-08 permanece local y no
habilita CUT2-08K ni CUT2-09. La familia canónica es
`public.reference_findings`; `REVIEW_REQUIRED` sigue siendo un estado local del
outbox, no una segunda tabla de hallazgos.

## Hallazgos corregidos durante CUT2-08H

1. La asignación autenticada no podía comprobar la capacidad del destinatario
   porque invocaba directamente el helper privado revocado. Las migraciones
   `20261017113000`, `20261017114500` y `20261017120000` introducen una frontera
   `SECURITY DEFINER` interna, deny-by-default, para los RPCs de findings.
2. El RLS de `reference_finding_events` ejecutaba el helper privado como el
   solicitante y negaba la lectura del timeline a un usuario autenticado válido.
   `20261017121500` usa el predicado interno scoped a `VIEW_MONITOR`.
3. El lint local detectó ambigüedad de `id` en el read-model de Monitor y una
   volatilidad incorrecta en elegibilidad. `20261017123500` cualifica la columna
   y marca la función como `VOLATILE`.

## Pruebas ejecutadas

| Área | Resultado |
| --- | --- |
| Reset local desde cero | PASS (migraciones CUT2-08 incluidas) |
| pgTAP completa | PASS — 44 archivos / 809 aserciones |
| Contract CUT2-08 | PASS — 20 aserciones |
| Regresión de derivación legacy | PASS — 8 aserciones |
| Lifecycle autenticado CUT2-08 | PASS focal — 26 aserciones, incluidas etiquetas scoped del detail |
| Evidence-after-resolution CUT2-08J | PASS — 18 aserciones: no crítica terminal, crítica reabre, audit, blocker, Monitor e idempotencia |
| Concurrencia propia CUT2-08 | PASS — dos conexiones PostgreSQL reales |
| Offline C2/C3 finding | PASS — restart, owner isolation y revocación terminal |
| C1 offline/post-seal | PASS — RPC productiva, evidencia idempotente, reinicio y owner-bound outbox |
| C1 post-seal sync contract | PASS — preserva evidencia y devuelve `REVIEW_REQUIRED / REFERENCE_SEALED` |
| Selector de asignación | PASS focal — candidatos scoped, legibles, capability-gated y anónimos bloqueados |
| Cliente | PASS — 172 suites / 467 pruebas |
| Chromium CUT2-08J4 | PASS — 49/49 escenarios, incluidos F01–F11 |
| Typecheck | PASS |
| Lint cliente | PASS |
| Build | PASS |
| DB security advisor local | PASS — 0 hallazgos |
| DB lint | PASS sin errores CUT2-08; quedan 3 warnings heredados |
| Regresión C2 de concurrencia | PASS — `recount_missions_c2_sla_queue_idx` |
| Regresión C3 de concurrencia/revocación | PASS — `recount_missions_c3_queue_idx` |
| Dataset/EXPLAIN CUT2-08J | PASS — 10.000 findings sintéticos locales, limpieza completa y sin índices nuevos |

El lifecycle autenticado ejecuta RPCs reales `create_preseal_reference_finding`,
`assign_reference_finding`, `add_reference_finding_evidence` y
`resolve_reference_finding`. Prueba identidad, source stage, severidad,
blocker de seal, audit único, idempotencia de assign/resolve, evidencia,
inmutabilidad por DML directo, decisión tipada y desbloqueo de preview.

`npm run test:cut2-08:concurrency` abre procesos `psql` independientes y
certifica: create/create por `source_event_key` (una fila y un audit),
resolve/resolve (una decisión/audit) y resolve-wins assign/resolve (el assign
posterior es denegado sin timeline contradictorio). También certifica ambas órdenes
de `resolve ↔ evidencia`: evidencia crítica primero queda disponible para la decisión;
resolución primero seguida por evidencia crítica aplica una reapertura controlada, sin
perder evidencia ni duplicar la resolución previa.

CUT2-08J fija una política única para evidencia posterior a la resolución: evidencia
no crítica se adjunta sin cambiar el estado terminal; evidencia crítica reabre el
mismo finding, conserva `resolved_by`, `resolved_at` y `resolution_code` históricos,
recalcula blockers y registra un único `REOPENED`. `source_event_id` es único por
finding, por lo que un retry devuelve la evidencia original sin duplicar sus audits ni
la reapertura. El contrato dedicado prueba además que Monitor scoped refleja el
resultado abierto/crítico.

El probe `npm run test:cut2-08:performance` crea dos inventarios/bodegas locales,
inserta y analiza 10.000 findings distribuidos entre estados, severidades y fuentes,
ejecuta `EXPLAIN (ANALYZE, BUFFERS)` y elimina el fixture incluso si falla. En esta
ejecución: lista open 3.416 ms mediante `reference_findings_blocking_idx`; búsqueda
crítica por identidad 0.065 ms mediante `reference_findings_canonical_open_idx`;
seal/RP blocker 1.703/1.742 ms con bitmap scan acotado; detalle/timeline 15.876/10.806
ms sobre el dataset. No hubo evidencia para añadir un índice nuevo.

El E2E focal usa una misión C3 real del harness de certificación: el formulario
de finding es operable y, después de reportar, el DOM continúa sin identidad
esperada, disponible, diferencia, C1 ni resultado previo.

El outbox existente de C2/C3 guarda `FINDING` bajo una clave por actor. Las
pruebas cliente cubren recreación de aplicación, cambio A→B, flush único,
reasignación stale y `AUTHORIZATION_REVOKED` como `REVIEW_REQUIRED` terminal.
CUT2-08J2 agrega el outbox C1 mínimo, versionado y actor-bound: persiste
`source_event_key`, identidad y evidencia, revalida autorización al flush y
convierte denegaciones terminales en `REVIEW_REQUIRED`, sin recrear ni mutar el
evento bajo la sesión de otro usuario. La RPC productiva preserva un reporte
offline tras sello como `OFFLINE_LATE_COUNT`, enlazado a su sealed reference.

CUT2-08J3 incorpora el read-model de detalle autorizado y la selección de
responsables sin enumeración de perfiles: detalle/evidence/timeline se obtiene
con `VIEW_MONITOR`; los candidatos requieren `FINDING_ASSIGN` y se validan de
nuevo en `assign_reference_finding`. La UI expone acciones sólo cuando las
capabilities efectivas las permiten; resolver continúa exigiendo una decisión
tipada.

## Garantías verificadas

- Una sola familia (`reference_findings`) y timeline append-only.
- El trigger corrige el defecto legacy: crítico sin sello deriva a
  `PRE_SEAL` / `CRITICAL` y conserva `blocks_seal`.
- Una resolución necesita `resolution_code`, actor y timestamp. `ADJUSTMENT_REQUIRED`
  registra una decisión; no ejecuta un ajuste ERP, release RP o exportación.
- Asignación, evidencia y resolución exigen actor activo, capability y scope en
  el servidor. Las rutas directas de actualización de estado/evidencia quedan
  denegadas para `authenticated`.
- Monitor proyecta findings por warehouse en servidor y no incluye cantidades
  esperadas/disponible/diferencias de C2/C3.

## Estado de cierre J3

## Cierre UI/E2E J4

La corrida completa de Chromium incluye 49/49 escenarios, incluidos F01–F11
agrupados por flujo:
reporte/reload C1, lista y detalle scoped, asignación, append de evidencia,
resolución tipada, reapertura con historial preservado, ausencia de acción sin
capability y blindness C2/C3. La UI no usa prompts para decisiones: sólo
presenta el catálogo canónico de códigos de resolución y no habilita el envío
sin nota. Los contratos de base de datos cubren RLS, RPC, capabilities, scope
e idempotencia.

La lectura detail ahora incluye etiquetas scoped de inventario, bodega, actor y
cadena C2/C3/corte. El lifecycle local incorpora tres aserciones permanentes
para esas etiquetas y preserva la resolución histórica cuando evidencia crítica
posterior reabre el mismo finding.

### Resultado final J4

- Reset local desde cero: PASS; migración J4 incluida.
- pgTAP: 44 archivos / 809 aserciones PASS.
- Cliente: 172 suites / 467 pruebas PASS.
- Chromium: 49/49 PASS, sin skipped ni timeout de fixture.
- Typecheck, lint y build: PASS. El build conserva sólo avisos heredados de
  comentarios PURE de zod y del tamaño de chunks; no son fallos CUT2-08.
- DB lint: sin errores CUT2-08; permanecen tres warnings heredados
  (inmutabilidad de canonical_rectification_payload y dos variables no usadas).
- Security Advisor: 0 hallazgos.
- Concurrencia: PASS con conexiones PostgreSQL independientes para
  create/create, resolve/resolve, assign/resolve y ambas órdenes de
  resolve/evidence; sin deadlock.
- Performance: PASS con 10.000 findings. Lista open 3.725 ms con
  reference_findings_blocking_idx; identidad crítica 0.066 ms con
  reference_findings_canonical_open_idx; detalle 14.539 ms y timeline
  10.944 ms. No se justificó un índice nuevo.

La matriz de ataques sigue cubierta por pgTAP: anon, scope de inventario o
bodega ajeno, capability ausente, DML directo de resolución/evidence y actor
inactivo reciben DENY. Los RPC SECURITY DEFINER mantienen search path vacío,
objetos cualificados, revocación de PUBLIC y grants mínimos.

No se realizó push, deploy, uso remoto ni CUT2-08K.

## Pre-freeze J5 — E2E conectado a servidor local

`npm run test:cut2-08:server-e2e` cruza Auth, PostgREST y RPCs del Supabase
local con usuarios autenticados reales y el outbox C1 actor-bound. No usa
fixtures de respuesta. Sus casos trazables son:

- **S01:** captura offline C1, `preview_rolling_cut_v2` y
  `create_rolling_cut_v2` reales sellan la referencia; el flush devuelve
  `REVIEW_REQUIRED / REFERENCE_SEALED`, persiste un único finding/evidence,
  conserva `captured_at` y el revisor scoped obtiene detail/timeline.
- **S02:** una revocación se realiza a través de la frontera administrativa
  local existente (`admin_upsert_user_profile_from_edge`). La mutación C1
  normal se deniega; `preserve_revoked_offline_c1_finding` deja un único
  `AUTHORIZATION_REVOKED_OFFLINE` revisable en servidor, con actor, identidad,
  evidencia y `source_event_key` originales.
- **S03:** varios flushes de ítems `REVIEW_REQUIRED` no producen llamadas
  mutativas, ni finding/evidence/audit duplicados.
- **S04:** la reasignación stale es N/A para la entrada C1: su payload no
  contiene assignee y el RPC sólo valida actor/capability/scope. La protección
  stale de misiones C2/C3 se mantiene cubierta por CUT2-07.
- **S05:** cambio de usuario y recreación del outbox no exponen ni envían los
  ítems de A como B; al volver A conserva sus dos registros terminales.

El cleanup del harness elimina también los eventos administrativos creados por
su revocación antes de retirar los perfiles temporales. Esto evita contaminar
las pruebas de RLS de administración. Todos los datos creados son fixtures
locales efímeros.

### Totales J5

| Control | Resultado local |
| --- | --- |
| Reset limpio | PASS — migración `20261018090000` aplicada desde cero |
| pgTAP completa | PASS — 44 archivos / 816 aserciones |
| Cliente | PASS — 81 archivos / 470 pruebas |
| Chromium | PASS — 49/49 escenarios de UI, sin timeout ni skip obligatorio |
| E2E servidor local | PASS — S01–S05, Auth + PostgREST + RPCs reales |
| Concurrencia | PASS — create/create, resolve/resolve, assign/resolve y ambas órdenes resolve/evidence |
| Performance | PASS — 10.000 findings; los índices existentes siguen siendo suficientes |
| Typecheck / lint / build | PASS — build sólo conserva avisos heredados de zod/chunk size |
| DB lint | PASS — 0 warnings CUT2-08; 3 warnings heredados |
| Security Advisor | PASS — 0 hallazgos |

No se creó un commit de certificación J5. El HEAD permanece
`0ceb56524b6711a19a0e07d420cf48c176565b69`; los cambios pre-freeze quedan
intencionalmente sin commit para la revisión CUT2-08K, sin push ni operación
remota.
