# Seguridad y RLS v1 — Fase 1

RLS está habilitado en todas las tablas operacionales. No hay políticas `USING (true)` ni acceso anónimo: `anon` no recibe grants de tablas, secuencias ni RPC. Los permisos de Data API se conceden explícitamente a `authenticated` y cada política limita filas por identidad, rol y asignación.

- **CONTADOR:** lee inventarios y maestro asignados; lee únicamente sus propios conteos. No tiene `INSERT` directo de conteos ni actualiza inventarios, perfiles, cortes o auditoría.
- **ANALISTA:** accede a inventarios que le fueron asignados y puede ejecutar RPC de ciclo de vida sobre ellos.
- **ADMIN:** administra perfiles/asignaciones, crea inventarios en BORRADOR y gestiona cualquier inventario mediante las RPC autorizadas.

Los helpers internos `app_private.current_app_role`, `app_private.is_admin`, `app_private.is_analyst`, `app_private.can_access_inventory` y `app_private.can_manage_inventory` centralizan la decisión y no son API pública. Son `SECURITY DEFINER`, fijan `search_path`, revocan `EXECUTE` y `USAGE` de `PUBLIC`, `anon` y `authenticated`; no aceptan un usuario o rol como parámetro.

Las transiciones sólo se exponen por `prepare_inventory`, `open_inventory`, `close_inventory` y `freeze_inventory`. Validan identidad, autorización, estado esperado, transición, escritura de auditoría y bloqueo por pendientes conocidos, dentro de la transacción de PostgreSQL. Los conteos no tienen `INSERT` directo: la futura escritura será exclusivamente mediante `sync_counts` RPC en Fase 4.
