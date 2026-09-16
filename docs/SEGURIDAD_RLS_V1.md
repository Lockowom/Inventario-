# Seguridad y RLS v1 — Fase 1

RLS está habilitado en todas las tablas operacionales. No hay políticas `USING (true)` ni acceso anónimo. Los permisos de Data API se conceden explícitamente a `authenticated` y cada política limita filas por identidad, rol y asignación.

- **CONTADOR:** lee inventarios y maestro asignados; inserta y lee únicamente sus conteos; no actualiza inventarios, perfiles, cortes ni auditoría.
- **ANALISTA:** accede a inventarios que le fueron asignados y puede ejecutar RPC de ciclo de vida sobre ellos.
- **ADMIN:** administra perfiles/asignaciones, crea inventarios en BORRADOR y gestiona cualquier inventario mediante las RPC autorizadas.

Los helpers `current_user_id`, `current_app_role`, `is_admin`, `is_analyst`, `can_access_inventory` y `can_manage_inventory` centralizan la decisión. Los helpers que necesitan evitar recursión RLS son `SECURITY DEFINER`, fijan `search_path` y revocan `EXECUTE` de `PUBLIC`; no aceptan un usuario o rol como parámetro.

Las transiciones sólo se exponen por `prepare_inventory`, `open_inventory`, `close_inventory` y `freeze_inventory`. Validan identidad, autorización, estado esperado, transición, escritura de auditoría y bloqueo por pendientes conocidos, dentro de la transacción de PostgreSQL.
