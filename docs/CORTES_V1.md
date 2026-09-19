# Cortes v1 — Fase 6

`public.create_cut(inventory_id, request_id)` es la única mutación de corte. Requiere perfil activo y gestión de inventario: ANALISTA asignado o ADMIN. CONTADOR no puede crear, listar ni leer cortes. Sólo admite inventarios `ABIERTO` o `CERRADO`; no usa las guardas de freeze para bloquear cortes parciales.

`request_id` es UUID obligatorio y único por inventario. Un reintento con el mismo identificador devuelve el mismo corte sin una segunda auditoría. Con un identificador distinto y cero filas elegibles, la RPC falla con “No existen conteos nuevos para incluir en el corte.”

En una transacción, la función toma `app_private.lock_inventory`, asigna el siguiente `cut_number` y selecciona sólo `count_records` del inventario con `cut_id IS NULL` y `export_seq IS NULL`. La asignación es set-based y determinista por `received_at ASC, id ASC`. Por ello `export_seq` es único, no se reinicia entre cortes y continúa globalmente por inventario. `record_count`, `first_export_seq` y `last_export_seq` quedan sujetos a una constraint de rango contiguo al alcanzar `SNAPSHOT_CREATED`.

Cada fila seleccionada recibe `cut_id` y `export_seq`; simultáneamente se inserta un `inventory_cut_items.snapshot` que conserva identidad, secuencia, campos físicos, descripción derivada, usuario, dispositivo, captura, recepción y estado de inventario al recibir. Las lecturas protegidas `list_inventory_cuts` y `get_cut_items` devuelven historial y detalle paginado desde esos snapshots, nunca reconstruido desde filas mutables.

Un conteo que llega después del snapshot queda sin corte para el siguiente; esto también permite que dispositivos offline sigan sincronizando. `CERRADO` no equivale a corte: un inventario abierto puede tener varios snapshots parciales. Fase 6 termina exactamente en `SNAPSHOT_CREATED`; no crea XLSX, Storage, hash de archivo, descarga ni rectificación posterior al corte.
