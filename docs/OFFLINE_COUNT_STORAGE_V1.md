# Offline count storage v1 — Fase 3

SQLite avanza mediante migraciones forward-only hasta v4. V3 crea `local_device_identity` con una identidad lógica por instalación y `local_count_records`. V4 agrega `local_counting_context`: una sola fila activa con `user_id`, `inventory_id`, `inventory_status = ABIERTO` y `verified_at`. Conserva exclusivamente metadata de la última autorización online; no almacena password, JWT, refresh token ni credenciales.

La base restringe cantidad a entero positivo, tipo a `SERIAL|PARTIDA|LEGACY`, estado a `PENDING|SYNCING|CONFIRMED|FAILED|REJECTED` y exige unicidad de `client_count_id`. Sus índices cubren inventario, usuario, código, `captured_at` y estado. No existe `DELETE` operacional en Fase 3.

`SqliteCountRepository` y `DexieCountRepository` implementan el mismo `CountRepository`: crear/leer identidad, guardar, reservar capacidad pendiente atómicamente, buscar por UUID de cliente, listar conteos propios y contar pendientes. Esta interfaz, y no SQL o Dexie, es el contrato de los casos de uso. La sincronización futura deberá ser idempotente sobre `client_count_id`, sin sustituir la copia local antes de una confirmación remota válida.

`SqliteCountingContextRepository` y `DexieCountingContextRepository` implementan el puerto semántico `CountingContextRepository`. Dexie expresa su modelo equivalente en versión 4, sin SQL emulado. La recuperación offline sólo acepta contexto persistido para la misma identidad de sesión local, y sólo cuando la verificación remota devuelve `UNAVAILABLE`; respuestas autoritativas negativas limpian la fila.
