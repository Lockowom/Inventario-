# Manifiesto de provisión QA y preparación Edge — F9B.4

Estado: `EXECUTED_PARTIAL / QA_ONLY`. La provisión autorizada ya fue ejecutada exclusivamente en `INVEN3-QA` (`uazunvlxlszdyweddxtb`): usuarios sintéticos, profiles, assignments, inventario, maestro mínimo, apertura, conteos, sync/idempotencia, controles RLS y un primer corte. No contiene credenciales ni secretos. Los gates conservan `ANDROID_PHYSICAL = MANUAL_REQUIRED`, `IOS_PHYSICAL = MANUAL_REQUIRED`, `RP_REAL_IMPORT = BLOCKED_EXTERNAL` y `BETA_MANUAL = MANUAL_REQUIRED`.

Baseline de provisión documentada: `24cdf452bb333fdaa1271d6305fc41c6c8475adc`. `REMOTE_QA_SECURITY_HARDENING_DEPLOYED = PASS`: 21/21 migraciones alineadas hasta `20260926043115_phase_9_remote_default_privilege_hardening.sql`. Las cuatro Edge Functions están `ACTIVE` con `verify_jwt = true`. El estado operacional posterior a la provisión está resumido en `REMOTE_QA_EXECUTION_STATUS.md`.

## A. Prechecks

El operador autorizado debe detenerse ante cualquier resultado distinto de los siguientes; este manifiesto no autoriza a corregir divergencias con `repair`, reescritura de historia ni SQL ad hoc.

1. Confirmar por escrito que el proyecto objetivo es QA, no producción, y que el project ref recibido por canal seguro coincide con el aprobado.
2. Comprobar identidad, organización y ambiente mediante la consola autorizada; no copiar tokens, llaves ni contraseñas al terminal compartido, Git, evidencia o ticket.
3. Confirmar history local/remoto 21/21, desde `20260916133820` hasta `20260926043115`, y que el hardening conserva: cero `anon`/`PUBLIC EXECUTE` público, cero DML/sequence grants para `anon`, y `inventory-rp` privado de 50 MiB con XLSX/JSON/ZIP.
4. Usar exactamente el SHA candidato aprobado y obtener CI verde antes de cualquier deploy: unit, pgTAP, E2E, visual, F7/F8, carga y advisors.
5. Preparar un backup/snapshot recuperable de QA, ventana de cambio, responsable y referencias de evidencia. Un QA vacío puede recrearse sólo con fixture sintético aprobado; nunca desde producción.
6. Verificar en el Dashboard autorizado que las claves y secretos de plataforma existen sin revelar sus valores. Ninguna clave secreta, JWT secret, DB password ni `SUPABASE_ACCESS_TOKEN` pertenece al bundle móvil.

## B. Edge deploy order

El orden operativo futuro es generador y luego descargador, primero F7 y después F8. Los cuatro despliegues conservan la configuración versionada `verify_jwt = true`; no se usa `--no-verify-jwt`.

| Orden | Función / entrypoint | Dependencias versionadas | RPC de usuario | RPC server-only / Storage | Resultado y recuperación |
|---:|---|---|---|---|---|
| 1 | `generate-cut-rp-xlsx` / `supabase/functions/generate-cut-rp-xlsx/index.ts` | `@supabase/server`, `@e965/xlsx@0.20.3`, `_shared/rp-contract.ts` | `request_cut_file_generation` | `get_cut_export_source`, `record_cut_file_generated`, `recover_cut_file_generated`, `mark_cut_file_validated`, `finalize_cut_file`, `mark_cut_file_error`; upload/download en `inventory-rp` | Genera, valida SHA/tamaño y transiciona a `READY`; recupera artefacto existente o deja el corte en `ERROR` con mensaje seguro. |
| 2 | `download-cut-rp-xlsx` / `supabase/functions/download-cut-rp-xlsx/index.ts` | `@supabase/server` | `get_cut_file_download` | `inventory-rp.createSignedUrl(..., 60, download)` | Sólo emite URL firmada tras autorización RPC; 403 para no autorizado, 500 si falla la firma. |
| 3 | `generate-inventory-artifact` / `supabase/functions/generate-inventory-artifact/index.ts` | `@supabase/server`, `@e965/xlsx@0.20.3`, `fflate@0.8.3`, `_shared/artifact-contract.ts` | `authorize_inventory_artifact_generation` | `claim_inventory_artifact_generation`, `get_inventory_artifact_source`, `record_inventory_artifact_generated`, `recover_inventory_artifact_generated`, `mark_inventory_artifact_validated`, `finalize_inventory_artifact`, `mark_inventory_artifact_error`; upload/download en `inventory-rp` | Valida contenido y SHA/tamaño; rechaza bytes inesperados en path reservado, recupera cuando corresponde o deja estado `ERROR`. |
| 4 | `download-inventory-artifact` / `supabase/functions/download-inventory-artifact/index.ts` | `@supabase/server` | `get_inventory_artifact_download` | `inventory-rp.createSignedUrl(..., 60, download)` | Devuelve URL firmada, nombre, SHA y tamaño sólo después de autorización RPC. |

El runtime Edge recibe las variables estándar de plataforma que consume `@supabase/server` (`SUPABASE_URL`, claves publishable/secret y JWKS); el código no lee ningún `Deno.env` de secreto adicional. Validar su presencia en el entorno administrado, nunca imprimir sus valores. Los generadores usan acceso administrativo únicamente dentro del runtime para las RPC server-only y el bucket privado; el cliente no recibe esa credencial.

## C. Expected `verify_jwt` and authentication

Las cuatro funciones esperan `auth: 'user'` y `verify_jwt = true`. La invocación aceptada es siempre de un usuario con sesión activa:

```text
Authorization: Bearer <Supabase user access token>
apikey: <QA public API key>
```

La plataforma valida primero el JWT de usuario y `withSupabase({ auth: 'user' })` entrega un cliente RLS-scoped; las RPC continúan resolviendo rol, perfil activo y assignment. Una API key sola identifica la aplicación pero **no** sustituye ni autoriza al usuario en este contrato.

### Decisión de key para el build QA

Para este candidato sin cambio de código, usar los nombres ya consumidos por la app:

```text
VITE_SUPABASE_URL
VITE_SUPABASE_ANON_KEY
VITE_APP_VERSION
```

`VITE_SUPABASE_ANON_KEY` debe contener únicamente la **legacy anon JWT key de QA** mientras el código y su nombre de variable permanezcan así. La clave es pública y sólo identifica el cliente; la autorización Edge proviene del JWT de sesión en `Authorization`. No usar una `sb_publishable` como `Authorization: Bearer`, ni asumir que cambiar el valor/nombre de la variable es una sustitución transparente bajo `verify_jwt = true`.

Supabase recomienda claves publishable para código distribuido y permite la coexistencia temporal con claves legacy. Una migración futura y separada podrá adoptar `VITE_SUPABASE_PUBLISHABLE_KEY` junto con una prueba explícita de cabeceras: `apikey` con la publishable y `Authorization` con un JWT de usuario. No se realiza esa migración incidentalmente en F9B.4. [Authorization headers](https://supabase.com/docs/guides/functions/auth-headers) · [API keys](https://supabase.com/docs/guides/getting-started/api-keys) · [Securing Edge Functions](https://supabase.com/docs/guides/functions/auth)

## D. Environment inputs

| Entorno | Variables públicas de build | Regla |
|---|---|---|
| Local | `VITE_SUPABASE_URL`, `VITE_SUPABASE_ANON_KEY`, `VITE_APP_VERSION`; `VITE_CERTIFICATION_FIXTURE` sólo en desarrollo | `.env.local` ignorado; nunca reutilizar valores QA o producción. |
| QA | `VITE_SUPABASE_URL`, `VITE_SUPABASE_ANON_KEY`, `VITE_APP_VERSION` | Valores de QA sólo en secretos/variables protegidas de build; el artefacto debe identificar SHA y versión QA. |
| Producción | Los mismos tres nombres con valores de producción | Entorno aislado; no reutilizar bundle, URL, usuarios ni datos QA. |

Secretos futuros del pipeline, sólo por nombre y sólo en almacenamiento cifrado: `SUPABASE_ACCESS_TOKEN`, `SUPABASE_PROJECT_ID`, `SUPABASE_DB_PASSWORD`. Son de operador/CI, no variables Vite ni inputs de Capacitor. Quedan prohibidos en fuente, build, logs, screenshots y evidencia: secret/service role key, JWT secret, contraseña de base y cualquier secreto Edge.

## E. Users

La provisión ejecutada creó exactamente tres identidades sintéticas; las credenciales permanecen fuera de Git y de la evidencia:

| Identidad | Auth | `public.profiles` | Uso QA |
|---|---|---|---|
| `qa-contador` | un `auth.users` confirmado | `display_name = 'QA CONTADOR'`, `role = CONTADOR`, `active = true` | Login, contexto autorizado, captura/sync y denegaciones de supervisión/artefactos no permitidos. |
| `qa-analista` | un `auth.users` confirmado | `display_name = 'QA ANALISTA'`, `role = ANALISTA`, `active = true` | Supervisión, cortes, RP y autorizaciones analíticas dentro del inventario asignado. |
| `qa-admin` | un `auth.users` confirmado | `display_name = 'QA ADMIN'`, `role = ADMIN`, `active = true` | Crear/preparar/abrir el inventario y cargar maestro sintético. |

El operador debe recuperar el UUID creado por Auth y asociarlo al `profiles.user_id` correcto, verificar `active = true`, y no decidir el rol desde `raw_user_meta_data`. La creación ya fue autorizada y ejecutada en QA; cualquier recreación, rotación de credenciales o provisión adicional requiere una decisión nueva y no forma parte de este manifiesto.

## F. Profiles

Después de crear las identidades por el canal administrativo aprobado, verificar lectura de perfil con cada sesión y que cada UUID corresponde a un único perfil. El rol se persiste en `public.profiles.role`, no en metadata editable. Si la creación de perfil, grant o RLS no coincide con las migraciones 21/21, detener el proceso y tratarlo como `SECURITY_BLOCKER`.

## G. Assignments

Se creó un único inventario sintético y asignaciones activas para los tres UUIDs, con trazabilidad UTC. `qa-contador` y `qa-analista` deben estar asignados para validar acceso; conservar un cuarto usuario sólo si una prueba posterior explícita necesita el caso no asignado. Comprobar que un usuario fuera de assignment recibe denegación/resultado vacío según contrato RLS, no acceso.

## H. Synthetic inventory

El objeto de trabajo ejecutado es `INVEN3_QA_SYNTHETIC_F9B4_20260926T0535Z`, creado como fixture sintética de QA. No usar IDs, nombres ni datos productivos.

La secuencia de ciclo de vida requerida es:

```text
BORRADOR
  → importar maestro sintético como ADMIN
  → PREPARADO mediante prepare_inventory
  → ABIERTO mediante open_inventory
```

Conservar evidencia de los tres estados. `ABIERTO` es el estado final de la fixture base de Device Health, sync, cortes y Edge. Escenarios de `CERRADO`, `CONGELADO`, recovery y rectificación deben ejecutarse en copias sintéticas separadas o tras capturar toda la evidencia necesaria, nunca reciclando una ejecución ya certificada.

## I. Synthetic master and count fixture

La importación de maestro se realiza mediante `import_inventory_master` autenticada como `qa-admin`, no mediante cargas de datos reales. El control se deriva de la última letra del código, por lo que la fixture mínima es:

| Código | Control esperado | Descripción sintética |
|---|---|---|
| `000123S` | `SERIAL` | `QA SERIAL — TALLA M — COLOR VERDE` |
| `000725P` | `PARTIDA` | `QA PARTIDA — TALLA L — COLOR AZUL` |
| `001234` | `LEGACY` | `QA LEGACY — PIEZA 001234` |

Los conteos sintéticos posteriores, capturados por `qa-contador` sobre el inventario `ABIERTO`, deben cubrir como mínimo:

| Caso | Código | Datos de conteo esperados |
|---|---|---|
| Serial válido | `000123S` | `serie = QA-SERIAL-0001`, `cantidad_contada = 1`, `partida = null`, fecha `2026-09-26`, talla `M`, color `VERDE`. |
| Partida con ceros | `000725P` | `partida = 00725`, `serie = null`, `pieza_producto = 001234`, fecha `2026-10-31`, talla `L`, color `AZUL`. |
| Legacy con blanks reales | `001234` | `serie`, `partida`, `pieza_producto`, `fecha_vencimiento`, `talla` y `color` explícitamente nulos; cantidad positiva. |

Usar ubicaciones válidas, UUIDs nuevos para `client_count_id`, `captured_at` UTC y cantidades positivas. Conservar evidencia de ceros iniciales como texto, fecha UTC exacta, nulos reales y no strings vacíos. La fuente e identificador de importación se etiquetan `QA_SYNTHETIC_F9B4`; no se usa RP ni ningún catálogo real.

## J. Verification SQL and read-only checks

Los siguientes son controles de lectura para que el operador autorizado los ejecute después de provisión. No deben incluir valores sensibles en la evidencia.

```sql
-- Functions publicas: anon y PUBLIC no ejecutan ninguna.
select count(*) = 0 as anon_public_execute
from pg_proc p join pg_namespace n on n.oid = p.pronamespace
where n.nspname = 'public' and has_function_privilege('anon', p.oid, 'EXECUTE');

select count(*) = 0 as public_public_execute
from pg_proc p join pg_namespace n on n.oid = p.pronamespace
cross join lateral aclexplode(coalesce(p.proacl, acldefault('f', p.proowner))) acl
where n.nspname = 'public' and acl.grantee = 0 and acl.privilege_type = 'EXECUTE';

-- La RPC de hora y el schema privado conservan sus grants cerrados.
select has_function_privilege('anon', 'public.get_server_time()', 'EXECUTE') as anon_server_time,
       has_function_privilege('authenticated', 'public.get_server_time()', 'EXECUTE') as authenticated_server_time,
       has_schema_privilege('anon', 'app_private', 'USAGE') as anon_app_private_usage,
       has_schema_privilege('authenticated', 'app_private', 'USAGE') as authenticated_app_private_usage;

-- Contrato de Storage.
select id, public, file_size_limit, allowed_mime_types
from storage.buckets where id = 'inventory-rp';
```

Después, con sesiones separadas, validar login/perfil/rol, assignments/RLS, `get_server_time()`, master metadata y lookup, sync idempotente, corte, artefactos, descarga firmada y que no exista escritura directa de Storage. Una URL firmada se comprueba por descarga, SHA y tamaño; no se registra el token de la URL en evidencia.

## K. Device Health verification

Ejecutar `LIGHT` y `FULL` en cada dispositivo físico preparado y documentar los once checks: `APP_VERSION`, `AUTH_USER`, `INVENTORY_CONTEXT`, `MASTER_SNAPSHOT`, `LOCAL_DATABASE`, `LOCAL_STORAGE`, `BACKEND_CONNECTIVITY`, `DEVICE_TIME`, `CAMERA_AVAILABLE`, `CAMERA_PERMISSION` y `SCANNER_AVAILABLE`.

La matriz debe producir evidencia real para `READY`, `READY_OFFLINE`, `READY_WITH_WARNINGS` y `BLOCKED`, sin cambiar sus reglas: respuestas server-authoritative prevalecen; offline sólo con cache autorizado; drift de hora ±5 minutos; cámara/scanner no bloqueantes; persistencia local bloqueante. Un scanner nunca es obligatorio. Los procedimientos detallados siguen en `DEVICE_QA_V1.md` y sus plantillas Android/iOS.

## L. Rollback / forward-fix plan

| Fallo | Acción aprobada futura |
|---|---|
| Divergencia de proyecto, history, grants, RLS o `verify_jwt` | Detener antes de deploy/provisión; conservar evidencia mínima, restaurar backup si corresponde y solicitar decisión. |
| Bundle QA configurado contra endpoint equivocado | Invalidar artefacto y reconstruir con variables del entorno correcto; no rotar ni revelar claves como atajo. |
| Error de función, RPC, Storage o firma | Detener la operación afectada, preservar IDs/estado/error seguro, corregir mediante commit y CI, y redeploy autorizado; no editar Edge remoto manualmente. |
| Fixture sintética errónea | Corregir por procedimiento QA aprobado o recrear el ambiente/dataset sintético; nunca borrar datos operacionales ni copiar producción. |
| DDL, grants o RLS | Sólo migración forward-fix revisada. No `migration repair`, squash ni edición de historia. |

## M. Evidence to capture

Registrar referencias, no secretos: autorización y ventana; SHA/build/app version; resultado de prechecks; lista de funciones y `verify_jwt`; UUIDs seudonimizados de usuarios/inventario/assignment; lifecycle y master fingerprint; Device Health; sync/reconnect/idempotencia; cortes/artefactos/SHA/size; acceso firmado; RLS/Storage denials; checks SQL resumidos; modelos/SO físicos; defectos, timestamps UTC y resultado de cada gate.

No declarar `PASS` físico, RP real o beta a partir de este manifiesto. Este documento no despliega Edge, crea usuarios, carga datos ni inicia Fase 10.
