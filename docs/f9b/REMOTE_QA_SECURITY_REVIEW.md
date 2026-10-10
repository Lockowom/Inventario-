# Revisión de seguridad remota QA — F9B.3

Estado: hardening preparado localmente; **no aplicado por Codex al proyecto remoto**. La revisión remota autorizada confirmó que INVEN3-QA (`uazunvlxlszdyweddxtb`) tiene 20/20 migraciones con timestamps idénticos al repositorio, desde `20260916133820` hasta `20260926001414`.

## Hallazgo real

Un proyecto Supabase nuevo conservó default privileges legacy en `public`:

- seis RPC `SECURITY DEFINER` tenían `anon EXECUTE`: `prepare_inventory`, `open_inventory`, `close_inventory`, `freeze_inventory`, `import_inventory_master` y `add_master_exception`;
- `public.inventory_master_metadata` y `public.inventory_master_exceptions` tenían grants directos heredados para `anon`.

RLS de ambas tablas sólo permite `authenticated`; no se observó bypass RLS ni evidencia de datos expuestos. En el momento de la revisión no había usuarios QA, datos QA ni conteos QA. El hardening se prepara antes de aprovisionar cualquiera de ellos.

## Corrección versionada

La migración `20260926043115_phase_9_remote_default_privilege_hardening.sql` es forward-only y realiza:

- revoke actual de todos los privilegios de `anon` sobre tablas y secuencias `public`;
- revoke de `EXECUTE` sobre todas las funciones `public` desde `PUBLIC` y `anon`, evitando la herencia del permiso PostgreSQL por defecto;
- confirmación de que `app_private` no concede `USAGE` a `anon` ni `authenticated`;
- default privileges para el **rol que ejecuta la migración**, sin hardcodear `supabase_admin`: se revoca `anon` para tablas/secuencias/functions y `PUBLIC` para ejecución de nuevas functions.

PostgreSQL aplica default privileges sólo a objetos futuros creados por el rol actual; no se heredan de roles miembros. Si un futuro proceso crea objetos con otro owner, debe ejecutar un hardening equivalente bajo ese owner antes de crear objetos. Esta limitación queda cubierta por la inspección de owner/default ACL previa a cualquier deploy.

No se revoca `authenticated` ni `service_role`: los grants explícitos existentes preservan entrypoints autenticados y de servidor. `public.get_server_time()` sigue `SECURITY INVOKER`, `search_path = ''`, sin `anon EXECUTE` y con `authenticated EXECUTE`.

## Regresión y alcance

El pgTAP nuevo prueba: ausencia de `anon EXECUTE` en todas las funciones `public`, sin DML/secuencias para `anon`, sin `PUBLIC EXECUTE`, `get_server_time`, aislamiento de `app_private`, RPCs críticos de `authenticated`, RPCs server-only de `service_role`, contrato privado de `inventory-rp` y objetos futuros creados por el ejecutor de migración.

No modifica políticas RLS, contratos de Sync, Edge Functions, diseño de Storage ni funciones `SECURITY DEFINER`. Los `SECURITY DEFINER` ejecutables por `authenticated` son entrypoints intencionales con autorización interna y cobertura pgTAP; los server-only permanecen sin `authenticated`. Si un entrypoint autenticado carece de control interno de autorización, debe abrirse `SECURITY_BLOCKER`; no se identificó uno en esta revisión.

## Observaciones no incluidas

Los findings informativos remotos de foreign keys sin índice, índices sin uso y múltiples policies permisivas se mantienen como observaciones de performance/operación. No se cambian aquí: requieren contraste separado con el contrato y la carga certificada.

## Referencias de plataforma

Supabase separa grants de RLS y documenta que los default privileges legacy pueden otorgar DML/EXECUTE de Data API. La migración revoca esos grants de forma explícita y preserva grants específicos. [Seguridad Data API](https://supabase.com/docs/guides/api/securing-your-api) · [Funciones](https://supabase.com/docs/guides/database/functions) · [Default privileges PostgreSQL](https://www.postgresql.org/docs/current/sql-alterdefaultprivileges.html).

Los gates no cambian: Android/iOS `MANUAL_REQUIRED`, RP `BLOCKED_EXTERNAL`, beta `MANUAL_REQUIRED`. No se crean usuarios, dataset QA, buckets ni despliegues en este ciclo.
