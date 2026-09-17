# Idempotencia v1 — Fase 4

`client_count_id` se genera una vez antes de guardar el conteo físico y es único en PostgreSQL. El cliente puede reintentar el mismo payload cuantas veces sea necesario.

- Si el UUID no existe y pasa las reglas del servidor, `sync_counts` inserta una vez y devuelve `ACCEPTED` con UUID de servidor y hora UTC de recepción.
- Si existe y todos los campos físicos inmutables, inventario, usuario y dispositivo coinciden, devuelve `ALREADY_ACCEPTED`; no inserta ni duplica auditoría.
- Si existe pero cualquiera de esos datos cambia, devuelve `CONFLICT` (`CLIENT_COUNT_ID_PAYLOAD_CONFLICT`). El servidor conserva el original y el cliente marca su cola como `REJECTED` para revisión.

La unicidad, comparación y auditoría viven en una función transaccional de PostgreSQL, no en el frontend. Las pruebas REST locales reenvían 2.350 registros (47×50) y verifican que el replay completo sea `ALREADY_ACCEPTED` y que el servidor conserve exactamente 2.350 filas.
