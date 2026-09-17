# Supervisión operacional v1 — Fase 5

## Alcance

La supervisión muestra evidencia recibida por el servidor para un inventario autorizado. No implementa edición de conteos, cortes, rectificaciones, exportación, stock ERP, diferencias, porcentajes de avance ni cambios de ciclo de vida.

## Modelo de acceso

| Actor | Acceso |
| --- | --- |
| CONTADOR | Sólo su resumen: conteos recibidos, unidades contadas, última captura y pendientes conocidos de sus dispositivos. |
| ANALISTA | Supervisión y búsqueda de inventarios a los que está asignado. |
| ADMIN | Supervisión y búsqueda global conforme a la política existente. |

La autorización se valida en cada RPC. No se infiere de metadata editable del cliente y no se conceden consultas directas a las tablas fuente.

## Modelos de lectura

`get_inventory_supervision(inventory_id)` devuelve nombre, estado, contadores asignados, conteos recibidos, unidades contadas, última recepción, dispositivos conocidos, pendientes conocidos, filas observacionales por contador/dispositivo y posibles series repetidas. `search_inventory_counts` filtra en servidor por contador, fecha, ubicación, código, serie y partida; devuelve 50 resultados por defecto y usa el cursor `(captured_at DESC, id DESC)`. `get_my_count_summary` es el contrato reducido del CONTADOR.

“Conteos recibidos” equivale a filas aceptadas con `received_at` del servidor. “Unidades contadas” suma `cantidad_contada` de esas filas. `captured_at` permanece como instante físico declarado por el dispositivo; no se sustituye por recepción.

## Dispositivos y pendientes

`last_seen_at` y `last_sync_at` describen la última observación conocida, no conectividad. La interfaz usa sólo `ACTIVO RECIENTEMENTE`, `SIN ACTIVIDAD RECIENTE` o `SIN DATOS`. “Pendientes conocidos” se deriva de `inventory_freeze_guards` sin resolver y no cubre instalaciones completamente offline. No hay heartbeat nuevo ni Realtime.

## Alertas y estados

Una serie duplicada se lista sólo si el SKU es `SERIAL`; es una alerta no bloqueante y no agrega una constraint única. La repetición de `PARTIDA` no dispara alerta. `CERRADO` sigue siendo consultable y `CONGELADO` sólo lectura. La UI es mobile-first, usa una columna en 320px y agrega columnas responsivas sin scroll horizontal operacional.
