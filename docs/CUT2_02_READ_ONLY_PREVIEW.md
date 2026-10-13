# CUT2-02 — preview local de pre-corte

`preview_rolling_cut_v2(inventory_id, warehouse_id?, selection?)` es un RPC de
lectura destinado exclusivamente a ADMIN y ANALISTA autorizados para el
inventario. Su objetivo es mostrar qué referencias *podrían* quedar listas,
requerir C2 o permanecer bloqueadas antes de que exista cualquier operación de
rolling cut.

## Límites deliberados

Esta entrega no crea cortes, no sella referencias, no altera conteos C1, no
crea misiones C2/C3, no cambia el ciclo de vida del inventario y no genera ni
libera archivos RP. No existe ningún workflow de activación en CUT2-02.

## Modelo de preview

La función cruza los conteos físicos C1 con el snapshot disponible de Softland
por la identidad normalizada `LEGACY`, `PARTIDA` o `SERIAL`. Las identidades
físicas incompletas no se descartan: aparecen como `INVALID_IDENTITY` y quedan
bloqueadas.

Cada referencia entrega cantidades físico/sistema, diferencia, ubicaciones,
estado de zona, evidencia/hallazgos y una de estas proyecciones:

- `BLOCKED`
- `OPEN_C1`
- `C2_REQUIRED_ESTIMATE`
- `RP_READY_ESTIMATE`

Los bloqueos incluyen referencia ya sellada, huérfano, UOM pendiente, saldo
disponible negativo, serie duplicada, evidencia pendiente/hallazgo crítico,
zona fuera de asignación, sincronización pendiente, ubicación no lista y
misiones C2/C3 activas.

## Seguridad y trazabilidad

La función exige identidad activa y `app_private.can_manage_inventory`; el rol
CONTADOR no puede consultar cantidades del snapshot. El privilegio se revoca a
`public` y `anon`; sólo `authenticated` puede invocarla bajo ese control.

La respuesta contiene un `preview_fingerprint` SHA-256 determinista, derivado
de las referencias candidatas, sus resultados y las políticas de tolerancia y
prioridad del inventario/bodega. El filtro opcional acepta únicamente
`normalized_reference_keys`, sin cambiar datos.

## Rendimiento

CUT2-02 agrega índices de soporte sobre identidad de conteo, casos/misiones de
reconteo y freeze guards abiertos. La verificación local incluye `EXPLAIN
(ANALYZE, BUFFERS)` del RPC con actor autorizado y fixture transaccional: 154.585
ms, sin dejar filas persistentes. La certificación de volumen real queda para
CUT2-03/QA: este preview no habilita ejecución operativa.

## Gate siguiente

El siguiente paso sólo puede decidirse tras revisar el preview local. La
habilitación de crear/sellar/ejecutar rolling cuts pertenece a CUT2-03 y queda
fuera de este cambio.
