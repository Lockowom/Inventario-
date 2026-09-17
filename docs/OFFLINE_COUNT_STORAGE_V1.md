# Offline count storage v1 — Fase 4

SQLite avanza mediante migraciones forward-only hasta v5. V3 crea el registro original y conteos; V4 agrega el contexto autorizado. V5 agrega `local_device_registrations` por `user_id` y el estado operativo de outbox. Un usuario que ya tenía conteos conserva su identificador para no romper pendientes; otro usuario de la misma instalación recibe uno nuevo y no puede heredar el registro ajeno.

La base restringe cantidad a entero positivo, tipo a `SERIAL|PARTIDA|LEGACY`, estado a `PENDING|SYNCING|CONFIRMED|FAILED|REJECTED` y exige unicidad de `client_count_id`. Sus índices cubren inventario, usuario, código, `captured_at` y estado. No existe `DELETE` operacional en Fase 3.

`SqliteCountRepository` y `DexieCountRepository` implementan el mismo `CountRepository`: registro por usuario, reserva atómica, reclamo/recovery de lote y transición desde ACK. `PENDING → SYNCING` se reclama dentro de la transacción; un `SYNCING` viejo vuelve a `FAILED`; los errores usan `next_retry_at`. La capacidad cuenta los tres estados no terminales. Esta interfaz, y no SQL o Dexie, es el contrato de los casos de uso.

`SqliteCountingContextRepository` y `DexieCountingContextRepository` implementan el puerto semántico `CountingContextRepository`. Dexie expresa su modelo equivalente en versión 4, sin SQL emulado. La recuperación offline sólo acepta contexto persistido para la misma identidad de sesión local, y sólo cuando la verificación remota devuelve `UNAVAILABLE`; respuestas autoritativas negativas limpian la fila.
