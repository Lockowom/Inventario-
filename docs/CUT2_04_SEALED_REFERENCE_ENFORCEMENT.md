# CUT2-04 — referencia sellada y evidencia offline

## Resultado

Una referencia en `SEALING` o `SEALED` no acepta nuevo C1. Un conteo que fue
capturado localmente antes de enterarse del sello conserva su payload, pero al
sincronizar se convierte una sola vez en un hallazgo abierto de
`reference_findings`; no se crea ni se modifica `count_records`.

El cliente conserva ese registro con estado local terminal `REVIEW_REQUIRED`.
Por ello sigue visible en **Mis conteos**, sobrevive reinicio y deja de ocupar
capacidad/outbox. No hay bucle de reintento ni pérdida silenciosa.

## Auditoría de rutas de escritura

| Ruta | Decisión CUT2-04 |
| --- | --- |
| Captura manual, scanner, web y Android | Guardan primero en el mismo outbox y llegan a `public.sync_counts`. |
| Reintento, reanudación, bulk sync y sincronización al iniciar | Usan `SyncManager` y el mismo RPC; `REFERENCE_SEALED` pasa a `REVIEW_REQUIRED`. |
| C1 ordinario después de sello | Rechazado con el código seguro `REFERENCE_SEALED`; el RPC crea/recupera el hallazgo idempotente. |
| C2 asignado y activo | Se reenvía al flujo F16 privado existente. CUT2-04 no lee ni expone información de su misión a C1. |
| `correct_uncut_count` | Evalúa la identidad destino y rechaza `REFERENCE_SEALED` antes de crear revisión o modificar el registro. |
| Importación/reconciliación/rectificación | No escriben nuevos conteos físicos por el cliente; conservan sus RPC y reglas propias. |
| Inserción directa a `count_records` | Revocada a `authenticated`; las pruebas verifican que el único camino de cliente sigue siendo RPC. |

## Integridad y concurrencia

`reference_findings.source_client_count_id` es único y contiene el payload
original, hora de captura y metadatos de dispositivo. La inserción usa
`ON CONFLICT` condicionado por identidad y payload: un retry equivalente
devuelve el mismo hallazgo; un UUID reutilizado con datos distintos falla como
conflicto. La fila de inventario continúa serializando `sync_counts` y el
sellado, y el índice único mantiene la propiedad aun frente a reintentos
concurrentes.

No se añadió un trigger genérico a `count_records`: bloquearía también el
camino legítimo C2. La defensa queda en el RPC de escritura, en el bloqueo de
inventario y en la revocación de DML directo; es el límite que permite C2 sin
crear una ruta de bypass para C1.

## Privacidad operativa

El contador recibe únicamente `REFERENCE_SEALED` y una explicación local
segura. No obtiene el identificador del hallazgo, detalle de corte, misión C2
ni estado de conciliación. Las políticas existentes dejan lectura de hallazgos
para ADMIN/ANALISTA con autorización de inventario.

## Pruebas locales

- `supabase/tests/cut2_03_rolling_cut_test.sql`: sello tardío, payload
  preservado, idempotencia de retry, DML directo bloqueado, corrección
  post-sello bloqueada y excepción C2 activa.
- `tests/unit/sync-manager.test.ts`: traducción a `REVIEW_REQUIRED`, payload
  durable y ausencia de reintento.
- `tests/unit/count-storage.test.ts`: persistencia Web/IndexedDB y exclusión
  de capacidad/outbox.

No se ejecutó ninguna migración remota, despliegue, OTA, push ni cambio de
producción durante CUT2-04.

## Validación realizada

- `supabase db reset --local --no-seed`: aplicado desde cero con la migración
  CUT2-04.
- `supabase test db --local supabase/tests`: PASS, 36 archivos y 618 pruebas.
- `supabase db advisors --local --type security --level warn --fail-on error`:
  PASS, sin hallazgos de seguridad.
- `supabase db lint --local --level warning`: sin errores CUT2-04. Conserva
  cuatro avisos heredados, ya documentados en CUT2-03N, de tres funciones no
  modificadas.
- TypeScript, lint, tests unitarios focales y build: PASS.
