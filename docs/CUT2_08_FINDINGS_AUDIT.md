# CUT2-08 — Auditoría de hallazgos y evidencia

Fecha: 2026-10-17. Alcance: local; no se consultaron ni cambiaron recursos remotos.

## Resultado

INVEN3 ya tiene una familia canónica apta para evolucionar: `public.reference_findings`.
`public.finding_evidence` es su evidencia inmutable. CUT2-08 extiende esa familia y no crea
una tabla de hallazgos paralela.

| Artefacto | Clasificación | Decisión CUT2-08 |
| --- | --- | --- |
| `reference_findings` | EXTEND / KEEP | Fuente canónica de estado, severidad, ownership, resolución, identidad y bloqueos. |
| `finding_evidence` | EXTEND / KEEP | Evidencia append-only por referencia a datos físicos, outbox y Storage; sin blobs. |
| `preseal_guard_events` | KEEP | Auditoría histórica pre-sello; los eventos nuevos se unifican en `finding_events`. |
| `recount_subtask_findings` | MERGE / LEGACY | Sigue siendo la captura compatible C2/C3; un trigger crea el finding canónico y evidencia exactamente una vez. |
| `source_client_count_id` y `late_count_payload` | KEEP | Idempotencia y evidencia de conteo tardío post-sello. |
| `REVIEW_REQUIRED` local | KEEP, separado | Estado terminal del outbox; no se confunde con un finding servidor. |
| `count_records` / `recount_mission_observations` | KEEP | Evidencia operacional referenciable, no duplicada. |
| `inventory_sealed_references` / rolling cuts | KEEP | Ancla post-sello y trazabilidad; no se reescribe el snapshot. |
| `reconciliation_cases` / C2 / C3 | EXTEND | Los findings enlazan la misión y respetan ceguera; no exponen cantidades previas. |
| Storage | KEEP | Sólo `storage_path` + hash en evidencia; no se introduce BYTEA/base64. |
| "finding_v2" u otra tabla de hallazgos | SAFE_TO_REMOVE (no creada) | Prohibida: fragmentaría la fuente de verdad. |

## Gaps detectados

1. `critical` era el único nivel de severidad y también se usaba como bloqueo pre-sello.
2. La resolución aceptaba texto libre y no mantenía una decisión tipada ni un historial unificado.
3. La captura C2/C3 (`recount_subtask_findings`) no tenía vínculo explícito al finding canónico.
4. No existía una matriz explícita de bloqueo por sello, finalización C2/C3, RP y cierre.
5. Monitor no tenía un read model de findings scoped en servidor.

## Invariantes que se preservan

- Identidad CUT2: `inventory_id + warehouse_id + referencia normalizada`; LEGACY, PARTIDA y SERIAL.
- Un finding pre-sello se enlaza al `sealed_reference` sin eliminarse ni duplicarse.
- Un late count utiliza `source_client_count_id` y no vuelve a abrir C1.
- `REVIEW_REQUIRED` continúa siendo local/outbox; el finding es el artefacto servidor auditable.
- C2/C3 conservan independencia: el read model no devuelve cantidades ni identidad de contadores previos.
- Resolver un finding jamás modifica stock ni ejecuta RP.

## Política CUT2-08

`severity` y `state` son dimensiones distintas. La matriz de bloqueo se persiste por
finding para que una resolución sea reproducible aun si la política evoluciona:

| Tipo / severidad | Sello | Completar C2/C3 | RP | Cierre |
| --- | --- | --- | --- | --- |
| `INFO` / `LOW` | No | No | No | No |
| `MEDIUM` | No, salvo policy explícita | No | No | No |
| `HIGH` | Sí si es pre-sello | No | Sí | No |
| `CRITICAL` | Sí | Sí si pertenece a la misión | Sí | Sí |
| `AUTHORIZATION_REVOKED_OFFLINE` | No | No | Sí | Sí |

La migración centraliza la derivación. No se permite usar un único booleano ambiguo
para todos los gates.

## Cierre local J4

La UI utiliza esta misma fuente canónica: la lista y el detalle son
proyecciones scoped del servidor, y las acciones invocan las RPC existentes
para asignación, evidencia y resolución tipada. No se añadió ninguna familia,
tabla ni autoridad de cliente adicional. La certificación final mantiene
aislamiento de bodega/inventario, ceguera C2/C3, evidencia append-only y el
estado local REVIEW_REQUIRED separado del artefacto canónico.

## Extensión local J5 — preservación por revocación

La auditoría inicial distinguía correctamente `REVIEW_REQUIRED` (estado del
outbox) del finding canónico, pero la primera implementación de revocación
sólo preservaba el payload en el dispositivo. J5 completa ese hueco sin crear
otra familia: tras la denegación de la mutación C1, un actor activo con vínculo
actual o histórico al mismo inventario puede preservar **sólo para revisión**
un `AUTHORIZATION_REVOKED_OFFLINE`. La frontera exige que ya no tenga
`FINDING_REPORT`, por lo que no puede funcionar como bypass.

El resultado queda en `reference_findings` y `finding_evidence`, es
idempotente por `source_event_key`, conserva provenance y se muestra sólo por
el read-model `VIEW_MONITOR` scoped. El mismo flujo no modifica conteos, no
reabre C1 y no altera snapshots o releases.
