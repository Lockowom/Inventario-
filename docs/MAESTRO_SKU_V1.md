# Maestro SKU v1 — Fase 2

Cada inventario tiene un snapshot propio de SKU. El contrato mínimo de carga es `CODIGO` y `DESCRIPCION`; CSV y XLSX aceptan encabezados con diferencias razonables de mayúsculas/minúsculas.

`CODIGO` se trata siempre como texto: trim exterior, mayúsculas y nunca conversión numérica. Por ello `00001234` conserva sus ceros. Si Excel ya entregó una celda numérica sin ceros, INVEN3 conserva el valor recibido y no inventa información perdida.

El tipo de control es derivado, nunca digitado: sufijo `S` → `SERIAL`, `P` → `PARTIDA`, cualquier otro → `LEGACY`.

## Preview e importación

El parser autodetecta CSV separado por coma o punto y coma, respetando comillas, BOM y finales de línea CRLF/LF. Devuelve total, válidas, rechazadas, duplicadas y vacías, además de fila, valores y motivos para cada rechazo. Mientras exista un rechazo, la UI no habilita confirmar. `import_inventory_master` es una RPC `SECURITY DEFINER` exclusiva de ADMIN: bloquea la fila de inventario con `FOR UPDATE` antes de validar el estado, valida todo el JSON, reemplaza el snapshot únicamente en `BORRADOR`/`PREPARADO`, recalcula metadata y audita `MASTER_IMPORTED` en una sola transacción.

Al abrirse el inventario, no existe reemplazo ni edición masiva. `add_master_exception` inserta un único SKU faltante **solo en `ABIERTO`** para ANALISTA asignado o ADMIN, exige motivo, deriva el tipo, incrementa versión y audita `MASTER_EXCEPTION_ADDED`. No descongela el maestro ni permite editar o borrar otros SKU. Las transiciones PREPARAR, ABRIR, CERRAR y CONGELAR bloquean esa misma fila antes de evaluar estado, por lo que no se intercalan con importaciones ni excepciones.
