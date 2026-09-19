# Idempotencia v1 — Fase 4

`client_count_id` se genera una vez antes de guardar el conteo físico y es único en PostgreSQL. El cliente puede reintentar el mismo payload cuantas veces sea necesario.

- Si el UUID no existe y pasa las reglas del servidor, `sync_counts` inserta una vez y devuelve `ACCEPTED` con UUID de servidor y hora UTC de recepción.
- Si existe y todos los campos físicos inmutables, inventario, usuario y dispositivo coinciden, devuelve `ALREADY_ACCEPTED`; no inserta ni duplica auditoría.
- Si existe pero cualquiera de esos datos cambia, devuelve `CONFLICT` (`CLIENT_COUNT_ID_PAYLOAD_CONFLICT`). El servidor conserva el original y el cliente marca su cola como `REJECTED` para revisión.

La unicidad, comparación y auditoría viven en una función transaccional de PostgreSQL, no en el frontend. Las pruebas REST locales reenvían 2.350 registros (47×50) y verifican que el replay completo sea `ALREADY_ACCEPTED` y que el servidor conserve exactamente 2.350 filas.
# Idempotencia de conteos v1

`client_count_id` identifica de manera inmutable la observación física aceptada por `sync_counts`, no el estado canónico que pueda resultar de correcciones posteriores. Un reintento compara siempre inventario, usuario, dispositivo y `captured_at` inmutables con el payload físico normalizado originalmente ingerido.

Fase 6 reconstruye ese payload sin duplicar una columna adicional: si el conteo nunca fue corregido, se deriva de `count_records`; si tiene revisiones, se usa `count_revisions.old_values` de `revision_number = 1`. La primera revisión es el estado inmediatamente anterior a cualquier corrección. Por tanto, un ACK perdido puede reenviar el payload original y recibir `ALREADY_ACCEPTED`, con el mismo ID y `received_at`, aun si la fila canónica ya fue corregida. Reenviar el payload corregido bajo el UUID original sigue siendo `CONFLICT`.
