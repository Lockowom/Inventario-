# Preflight de entorno remoto para QA físico — F9B.2

Estado: planificación solamente. Este documento no enlaza, autentica, consulta ni modifica un proyecto remoto. Los gates se conservan: `ANDROID_PHYSICAL = MANUAL_REQUIRED`, `IOS_PHYSICAL = MANUAL_REQUIRED`, `RP_REAL_IMPORT = BLOCKED_EXTERNAL`, `BETA_MANUAL = MANUAL_REQUIRED`.

## Decisión de entorno

F9B requiere un proyecto Supabase remoto **QA/STAGING separado** de producción, con PostgreSQL, Auth, Data API, RLS, Storage privado y Edge Functions. Debe servir únicamente datos sintéticos/controlados y permitir login desde Android/iOS, sync de conteos, cortes, artefactos y `get_server_time()`.

Si el único proyecto remoto disponible es producción, el estado es `REMOTE_QA_ENVIRONMENT = BLOCKED_PENDING_AUTHORIZATION`. No se reutiliza producción, Inventario General, datos personales ni datos productivos sin autorización explícita.

## Inspección local realizada

| Elemento | Resultado |
|---|---|
| CLI | `2.114.0` |
| `supabase/config.toml` | proyecto local `inven3`, Postgres 17, API `public`/`graphql_public`, Auth/Storage/Edge habilitados, pg-delta habilitado |
| Migraciones versionadas | 20, forward-only; primera `20260916133820_phase_1_initial_model_security.sql`, última `20260926001414_device_health_server_time.sql` |
| `migration list --local` | ejecutado; no pudo conectar porque la pila local no estaba iniciada en `127.0.0.1:54322`. No se inició ni consultó remoto. |
| Seed | `supabase/seed/phase_1_safe_dev_seed.sql`; crea sólo fixture de desarrollo local |
| pgTAP local | 9 archivos de F1–F9 |
| Credenciales versionadas | no se detectaron valores secretos mediante escaneo de archivos rastreados; `.env.example` sólo declara nombres públicos vacíos |

### Backend local inventariado

- **17 tablas:** 16 en `public` (`profiles`, inventarios, asignaciones, maestro, sync, conteos, cortes, rectificaciones, archivos, auditoría y artefactos) y `app_private.inventory_device_activity`.
- **RLS:** las 16 tablas `public` tienen RLS habilitado; las policies, grants y RPCs están versionados por migración. `app_private` no es parte de la API expuesta.
- **RPC:** 36 funciones públicas detectadas. Para F9B son operacionales `register_sync_device`, `report_device_sync_state`, `sync_counts`, `get_server_time`, `create_cut`, `get_cut_items`, `request_cut_file_generation`, `get_cut_file_download`, `rectify_cut`, `authorize_inventory_artifact_generation` y `get_inventory_artifact_download`; las transiciones internas de generación se reservan a `service_role` desde Edge.
- **Device Health:** `public.get_server_time()` está definido como `SECURITY INVOKER`, `search_path = ''`, con `PUBLIC` y `anon` revocados y `authenticated` con `EXECUTE`. Es requerido en QA, pero no se despliega en este preflight.
- **Storage:** existe un único bucket `inventory-rp`, privado, límite 50 MiB; acepta XLSX, JSON y ZIP. No se detectaron policies que permitan escritura directa desde clientes autenticados; los uploads son de Edge con credencial de servidor. Las descargas de app pasan por autorización y URL firmada limitada.
- **Edge Functions:** cuatro, todas con `verify_jwt = true`: `generate-cut-rp-xlsx`, `download-cut-rp-xlsx`, `generate-inventory-artifact`, `download-inventory-artifact`.

## Inventario de riesgo de migraciones

Todas las migraciones son necesarias para levantar un QA vacío de F9B. `HIGH` exige revisión de impacto, RLS, grants y/o ciclo de vida antes de despliegue.

| Timestamp | Migración | Scope | Riesgo |
|---|---|---|---|
| 20260916133820 | phase_1_initial_model_security | 13 tablas base, enums, RLS, policies, grants, triggers | HIGH |
| 20260916154509 | phase_2_master_offline | metadata/excepciones de maestro, import RPC | HIGH |
| 20260916162137 | phase_2_review_hardening | lifecycle inventario y RPC SECURITY DEFINER | HIGH |
| 20260917115821 | phase_4_sync_engine | sync devices/counts, idempotencia, grants | HIGH |
| 20260917212503 | phase_5_supervision | RPCs de supervisión/búsqueda | HIGH |
| 20260917215408 | phase_5_inventory_scoped_activity | actividad de dispositivo, RLS/auditoría | HIGH |
| 20260917223957 | phase_6_cuts | cortes, snapshots, freeze, RLS | HIGH |
| 20260919194702 | phase_6_replay_original_payload | replay idempotente de sync | HIGH |
| 20260919201005 | phase_7_rp_xlsx | bucket privado, XLSX, RPCs de corte | HIGH |
| 20260919205419 | phase_7_hardening | estados/metadata de generación y grants | HIGH |
| 20260919221645 | phase_7_recovery_evidence | recuperación de generación | HIGH |
| 20260920002009 | phase_7_verified_recovery | verificación de recovery | HIGH |
| 20260920004130 | phase_7_cut_read_model | RPC de lectura paginada | MEDIUM |
| 20260920012139 | phase_7_server_rpc_privileges | revokes/grants service role | HIGH |
| 20260921110215 | phase_7_harness_metadata_read | grant de metadata a servicio | MEDIUM |
| 20260921193000 | phase_7_validated_audit_requester | atribución de auditoría | HIGH |
| 20260922143348 | phase_8_rectifications_artifacts | rectificaciones, artefactos, RLS/funciones | HIGH |
| 20260922154155 | phase_8b_contract_hardening | constraints e idempotencia F8 | HIGH |
| 20260923110907 | phase_8c_artifact_pipeline | pipeline/Storage de artefactos, grants | HIGH |
| 20260926001414 | device_health_server_time | RPC invoker autenticado | MEDIUM |

## Variables de cliente y secretos

El cliente sólo lee `VITE_SUPABASE_URL` y `VITE_SUPABASE_ANON_KEY` en `src/services/supabase.ts`. Son valores públicos/publishable: Vite los incorpora al bundle web que Capacitor empaqueta para Android/iOS. Usar un archivo local ignorado (`.env.local`) o variables de build de CI; no commitear una configuración QA.

Nunca incluir en la app, bundle, repositorio, logs ni artefactos: `service_role`/secret key, `SUPABASE_ACCESS_TOKEN`, contraseña DB, JWT secret ni valores de secretos Edge. El rol de app proviene de `public.profiles.active/role` y asignaciones, no de `user_metadata` editable.

Para un futuro workflow de despliegue, los nombres de secretos de CI pueden ser `SUPABASE_ACCESS_TOKEN`, `SUPABASE_PROJECT_ID` y `SUPABASE_DB_PASSWORD`; sus valores deben residir exclusivamente como secretos cifrados del entorno QA. Los secretos internos que el runtime Edge suministra no se imprimen ni se inyectan en el cliente.

## Auth, roles y dataset QA mínimo

Antes de hardware se requieren tres usuarios QA creados por un operador autorizado: `CONTADOR`, `ANALISTA`, `ADMIN`; cada uno con `auth.users`, perfil activo en `public.profiles` y asignaciones activas conforme al flujo a probar. No se autorizan mediante `raw_user_meta_data`.

El dataset sintético necesita un inventario QA `ABIERTO`, maestro controlado y conteos aislados. Debe incluir controles `SERIAL`, `PARTIDA`, `LEGACY`; códigos con ceros iniciales, partida `00725`, pieza `001234`, fecha y fecha vacía, talla/color. No se insertan datos durante este preflight.

## Cambios de plataforma relevantes

- Supabase anuncia que las tablas `public` dejan de exponerse automáticamente por Data API; revisar exposición y grants explícitos tras crear QA, sin asumir el comportamiento legacy. Esto afecta migraciones futuras y verificación de API, no autoriza cambios en este ciclo. [Changelog](https://supabase.com/changelog?types=breaking-change)
- Las claves publishable/anon son las únicas admisibles en cliente con RLS; secret/service-role sólo son de entorno confiable y el servicio bypassa RLS. [API security](https://supabase.com/docs/guides/api/securing-your-api) · [Function secrets](https://supabase.com/docs/guides/functions/secrets)
- Las funciones configuradas con `verify_jwt = true` requieren JWT de usuario válido; validar `Authorization` y `apikey` en el QA posterior. [Function auth](https://supabase.com/docs/guides/functions/auth-headers)
- La configuración local usa pg-delta; todo diff futuro debe revisarse porque puede incluir grants/revokes. [Migrations](https://supabase.com/docs/guides/deployment/database-migrations)

## Secuencia futura, sólo después de autorización explícita

1. Recibir project ref y confirmar por escrito que es QA/STAGING, no producción.
2. Autenticar un contexto autorizado y verificar identidad del proyecto.
3. Leer migration history remota y comparar con las 20 migraciones locales; detectar divergencias antes de proponer cualquier acción.
4. Inspeccionar schema diff, RLS, grants, funciones SECURITY DEFINER/INVOKER, Storage y Data API exposure; ejecutar advisors.
5. Determinar backup/snapshot de QA según impacto y ventana aprobada.
6. Aplicar exclusivamente migraciones conocidas y faltantes mediante flujo revisado; **no ejecutar `supabase db push` a ciegas**.
7. Desplegar las cuatro funciones con sus secretos de entorno previamente configurados, sin exponerlos.
8. Cargar sólo usuarios, asignaciones, inventario y maestro sintéticos aprobados.
9. Ejecutar la verificación posterior y registrar evidencia F9B.

## Verificación remota posterior planificada

Auth login; perfiles/roles; assignments/RLS; maestro; sync y reconnect offline; `get_server_time`; corte; XLSX; rectificación; generación de artefactos; descarga firmada; bucket privado; advisors. Android/iOS físicos sólo pueden empezar cuando staging, build QA, usuario QA, inventario `ABIERTO`, maestro y SHA candidato estén listos.

## Recovery y blockers

| Categoría | Recuperación futura |
|---|---|
| DDL/RLS/grants/RPC | migración forward-fix revisada; no editar historial ni usar repair como atajo |
| Datos QA | restaurar backup/snapshot QA o recrear dataset sintético; nunca copiar producción por conveniencia |
| Edge/Storage | detener exposición, corregir configuración/secret en entorno QA, redeploy revisado y verificar URL firmada/RLS |
| Divergencia de historial/schema | detener antes de deploy, conservar evidencia, analizar diff y solicitar decisión autorizada |

Blockers actuales: no existe project ref ni autorización para un QA remoto, no existen credenciales QA ni usuarios/dataset QA autorizados y no hay build físico configurado. Si sólo se ofrece producción, permanece `REMOTE_QA_ENVIRONMENT = BLOCKED_PENDING_AUTHORIZATION`.

## Seguimiento F9B.3

La revisión posterior de default privileges está documentada en [REMOTE_QA_SECURITY_REVIEW.md](REMOTE_QA_SECURITY_REVIEW.md). Su migración de hardening sigue pendiente de aplicación autorizada; no cambia el estado de los gates manuales.
