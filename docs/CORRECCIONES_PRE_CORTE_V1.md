# Correcciones pre-corte v1 — Fase 6

La corrección canónica es `public.correct_uncut_count(count_record_id, physical_payload, reason)`. El actor procede exclusivamente de `auth.uid()` y debe tener un perfil activo. El cliente no puede aportar propietario, inventario, dispositivo, timestamps, `client_count_id`, `cut_id` ni `export_seq`.

Sólo se corrigen los nueve campos físicos: ubicación, código, serie, partida, pieza, vencimiento, talla, color y cantidad. La descripción no es editable: PostgreSQL la vuelve a obtener desde `inventory_master_items`. Se normalizan texto y mayúsculas y se vuelven a aplicar las reglas de Fase 4: ubicación contractual, SKU presente, SERIAL con serie de hasta 19 caracteres/cantidad 1/sin partida, PARTIDA con partida/sin serie/cantidad positiva y LEGACY con serie/partida opcionales.

CONTADOR requiere que el registro sea propio y que conserve asignación activa; ANALISTA requiere gestión del inventario asignado; ADMIN conserva alcance global. El inventario debe ser `ABIERTO` o `CERRADO`; `BORRADOR`, `PREPARADO` y `CONGELADO` rechazan la acción. El motivo se hace `trim`, no puede ser vacío y tiene máximo 500 caracteres.

La RPC bloquea primero la fila de inventario mediante `app_private.lock_inventory`, luego el conteo con `FOR UPDATE`. Rechaza cualquier registro que ya tenga `cut_id` o `export_seq`. En la misma transacción agrega una fila inmutable a `count_revisions` con valores viejo/nuevo, número monotónico, actor y motivo; actualiza el registro físico y genera `COUNT_CORRECTED`. El bloqueo común con `create_cut` garantiza que una corrección completa entra en el snapshot o, si el corte gana, queda rechazada: nunca hay un estado mixto.

La corrección ocurre sólo sobre la copia canónica ya recibida por servidor. El outbox local no se reescribe ni reutiliza un `client_count_id` luego de empezar sync; se preserva así la idempotencia y el conflicto seguro de Fase 4.

La idempotencia de la observación original se conserva incluso después de una corrección: `sync_counts` consulta el payload anterior a la primera revisión, no los campos canónicos actuales. Así, un ACK perdido puede reintentarse con su payload original sin revertir la corrección; el payload corregido no se convierte en un replay válido del UUID original.
