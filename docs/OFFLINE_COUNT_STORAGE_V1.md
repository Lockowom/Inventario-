# Offline count storage v1 — Fase 3

SQLite avanza mediante la migración forward-only v3. Crea `local_device_identity` con una identidad lógica por instalación y `local_count_records`. La tabla contiene UUID local y de cliente, inventario, usuario, dispositivo, los campos físicos A:J, tipo de control, timestamps UTC, estado, intentos y último error de sincronización.

La base restringe cantidad a entero positivo, tipo a `SERIAL|PARTIDA|LEGACY`, estado a `PENDING|SYNCING|CONFIRMED|FAILED|REJECTED` y exige unicidad de `client_count_id`. Sus índices cubren inventario, usuario, código, `captured_at` y estado. No existe `DELETE` operacional en Fase 3.

`SqliteCountRepository` y `DexieCountRepository` implementan el mismo `CountRepository`: crear/leer identidad, guardar, buscar por UUID de cliente, listar conteos propios y contar pendientes. Esta interfaz, y no SQL o Dexie, es el contrato de los casos de uso. La sincronización futura deberá ser idempotente sobre `client_count_id`, sin sustituir la copia local antes de una confirmación remota válida.
