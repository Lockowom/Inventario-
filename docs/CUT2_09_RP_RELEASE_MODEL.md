# CUT2-09B2 — Core de release RP local

## Autoridad y límites

`app_private.rp_release_eligibility` es la única autoridad de readiness RP.
`public.preview_rp_release` y `public.create_rp_release` la consumen; el
cliente no deriva eligibility. El core crea sólo un batch `DRAFT` y su
snapshot inmutable. No genera XLSX, no finaliza `READY` y no escribe ERP,
stock, referencias selladas, C1, C2, C3 ni findings.

## Preview y fingerprint

El preview exige `RP_RELEASE`, actor activo y scope de inventario/bodega. Sus
items se ordenan por bodega, tipo de identidad, SKU, valor de referencia e id.
El SHA-256 se calcula sobre identidad, cantidad sellada, eligibility,
blockers y corte fuente; no usa reloj ni valores de presentación.

Blockers actuales:

| Código | Fuente |
| --- | --- |
| `NEGATIVE_QUANTITY` | referencia sellada sin cantidad válida |
| `BLOCKS_RP_FINDING` | finding abierto/en espera con `blocks_rp` o crítico |
| `OPEN_C2` / `OPEN_C3` | misión de recuento en cola o activa |
| `UNRESOLVED_REVIEW` | finding abierto de autorización revocada offline |
| `ORPHAN_REFERENCE` | huérfano con `block_rp` |
| `UOM_CONFLICT` | caso UOM abierto/en espera sobre la referencia |

La matriz de review no se decide por un nombre genérico: actualmente
`AUTHORIZATION_REVOKED_OFFLINE` es crítico por taxonomía CUT2-08, conserva
`blocks_rp` y además aparece como `UNRESOLVED_REVIEW` hasta una decisión
tipada. `OFFLINE_LATE_COUNT` por sí solo conserva evidencia, pero su bloqueo
RP se rige por `blocks_rp`/severidad, no por el texto de su stage.

## Create e idempotencia

`create_rp_release(inventory_id, warehouse_id, reference_ids,
expected_fingerprint, request_id)`:

1. Exige `RP_RELEASE` scoped y una selección no vacía, única y de una bodega.
2. Bloquea la fila de inventario, consulta la clave idempotente
   `(inventory_id, created_by, request_id)` y vuelve a calcular el preview.
3. Responde `PREVIEW_STALE` si el fingerprint ya no representa el estado
   material, o `RP_RELEASE_BLOCKED` si alguna referencia no es elegible.
4. Inserta atómicamente `rp_release_batches` en `DRAFT` y un snapshot
   inmutable en `rp_release_audits`.
5. Repeticiones equivalentes devuelven el mismo `release_id`; reutilizar el
   request id con otro fingerprint devuelve `IDEMPOTENCY_CONFLICT`.

La auditoría existente conserva el evento canónico `RELEASE_CREATED` en su
`policy_snapshot` y el conjunto de items en `references_snapshot`. Los campos
de artefacto XLSX quedan nulos únicamente mientras el batch está en `DRAFT`;
siguen siendo obligatorios para cualquier `READY` heredado.

## Inmutabilidad, lineage y concurrencia

`rp_release_audits` ya es append-only y no se refresca cuando cambian
findings/recuentos posteriores. Cada item del snapshot conserva la referencia
sellada, identidad, cantidad y corte fuente. El orden de locks del writer es:
inventario → referencias selladas seleccionadas (`FOR UPDATE`) → batch
idempotente preexistente → eligibility. Los inserts de finding, C2/C3 y UOM
que referencian una identidad seleccionada necesitan un lock FK conflictivo:
por lo tanto se confirman antes de la revalidación o después del snapshot.
Esto serializa `create/create` para un inventario; los cambios posteriores no
alteran releases creados.

El harness local `scripts/cut2-09-rp-release-concurrency.mjs` ejerce ambas
órdenes para finding/C2/C3. Si el hecho dependiente confirma antes, `F1` es
obsoleto y no hay escritura de release. Si el writer confirma primero, el
hecho espera el lock FK de la referencia y se inserta después: el batch y su
auditoría conservan el fingerprint original. El orden es único
`inventario → referencias seleccionadas → batch idempotente → eligibility`;
no se toman locks globales.

## Scope, inyección y no-ERP

El writer exige una sola bodega explícita. Una referencia ajena a inventario o
bodega, no sellada, repetida o no incluida en la selección se rechaza antes de
insertar el batch. El contrato B3 verifica además que un create exitoso no
modifica `count_records`, `recount_missions` ni `inventory_sealed_references`.
Las únicas escrituras del core son el batch `DRAFT` y su auditoría.

`rp_release_rectifications` y `rp_release_discards` no son entrada a
eligibility: ambos están ligados a un `release_id` ya creado. Por diseño no
pueden bloquear la creación de su propio release; su política aplica a la
rectificación o descarte posterior, fuera de CUT2-09B.

## Identidad, cantidades y ausencia de ERP

`inventory_sealed_references` es la autoridad canónica de identidad: LEGACY
exige SKU normalizado sin valor auxiliar; PARTIDA y SERIAL exigen valor no nulo
y normalizado. Una cantidad negativa tampoco puede persistirse. Por eso esas
formas inválidas se rechazan antes de eligibility y no se degradan a otra
identidad. Cero es una cantidad física válida si no tiene otro blocker.

Los fingerprints son específicos de la selección: un cambio en LOT-B o
SER-002 altera un preview que lo incluye, pero no LOT-A/SER-001 aislados. El
core sólo contiene DML para `rp_release_batches` y `rp_release_audits`; no
escribe stock, movimientos, Softland/ERP, C1/C2/C3, findings ni lifecycle.

## Validación local B2

`cut2_09_rp_release_core_test.sql` cubre DRAFT, snapshot/audit, retry,
`PREVIEW_STALE`, C2/C3 y findings. El contrato B3 de seguridad/blockers cubre
scope, inyección, UOM, orphan, inmutabilidad y ausencia de mutación C1/C2/C3.
## CUT2-09C: manifiesto y exportación local

`rp_release_batches` sigue siendo el único release canónico y
`rp_release_audits.references_snapshot` sigue siendo la única fuente de filas
para exportar. CUT2-09C no consulta elegibilidad en vivo al descargar ni crea
movimientos ERP.

- `mark_rp_release_ready` bloquea la fila DRAFT, rederiva el manifiesto y exige
  que el número de filas del snapshot coincida. Sólo entonces transiciona a
  `READY`; el retry con la misma solicitud es idempotente.
- El manifiesto contiene release, inventario, bodega, creador, instante de
  creación, cardinalidad, versión, fingerprint y digest ordenado. El digest
  ordena por bodega, identidad, SKU, valor de identidad y referencia sellada.
- `prepare_rp_release_export` exige `READY`, capability `RP_RELEASE` y scope
  actual. Registra `RELEASE_EXPORTED` idempotentemente por request id y entrega
  sólo el snapshot inmutable al cliente.
- El cliente crea un libro XLSX con `RP_RELEASE` y una única hoja `MANIFEST`.
  Los textos que comienzan por `=`, `+`, `-` o `@` se escapan con apóstrofo; no
  hay fórmulas. El contenido lógico es reproducible, aunque el contenedor ZIP
  puede variar sus metadatos binarios entre ejecuciones.

`READY` es una certificación de snapshot/manifiesto, no una liberación de ERP,
ni un ajuste de stock, ni una exportación a un proveedor externo.
