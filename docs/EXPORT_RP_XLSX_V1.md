# Exportación RP XLSX v1 — Fase 7

El archivo oficial se genera exclusivamente en la Edge Function `generate-cut-rp-xlsx`, con credenciales de servicio que nunca llegan al navegador. Su única fuente son `inventory_cut_items.snapshot`, ordenados por `export_seq`; no reconsulta campos físicos ni descripción desde `count_records`.

Cada archivo contiene exactamente una hoja llamada `INVENTARIO`, sin filas previas ni columnas adicionales: `CODIGO`, `SERIE`, `PARTIDA`, `PIEZA DEL PRODUCTO`, `FECHA DE VENCIMIENTO`, `Talla del producto`, `Color del Producto`, `Cantidad Contada`, `DESCRIPCION`. Identificadores son celdas texto, la fecha es fecha XLSX `dd-mm-yyyy` o vacía y cantidad es entero XLSX positivo. No hay fórmulas.

Antes de emitir bytes se valida que los snapshots tengan conteo, mínimo, máximo y secuencia consecutiva coherentes con el corte. Después de subirlos al bucket privado `inventory-rp`, un validador independiente vuelve a abrir los bytes y verifica hoja, rango, encabezados, tipos, fórmulas y round-trip.

El ciclo es `SNAPSHOT_CREATED → FILE_GENERATED → VALIDATED → READY`; `ERROR` permite un reintento seguro y `READY` recupera el artefacto existente. `generated_files` conserva el único artefacto oficial `CUT_XLSX` por corte, con MIME, SHA-256, tamaño, nombre estable y ruta privada. La descarga se entrega mediante URL firmada de 60 segundos sólo después de autorización ANALISTA asignado o ADMIN.
