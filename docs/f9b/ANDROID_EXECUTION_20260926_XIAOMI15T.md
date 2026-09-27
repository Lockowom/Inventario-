# Ejecución Android física — Xiaomi 15T — 2026-09-26

## Identificación

| Campo | Valor |
|---|---|
| execution_id | `ANDROID-XIAOMI15T-20260926-01` |
| gate | `ANDROID_PHYSICAL` |
| status | `IN_PROGRESS` |
| candidate_sha / build_sha | `1328bc28a990136517c1d6d39555e4b44530ccab` |
| app_version | `f9b-qa-1328bc28` |
| observed_at | `2026-09-26T16:39:12Z` |
| environment | `INVEN3-QA` (`uazunvlxlszdyweddxtb`) |
| device_model | Xiaomi 15T |
| evidence | screenshots físicas aportadas durante ejecución F9B |
| notes | Primera ejecución real donde Device Health LIGHT alcanza `READY_WITH_WARNINGS`. Gate global aún no cerrado. |

## Device Health LIGHT

Resultado observado: `READY_WITH_WARNINGS` / “DISPOSITIVO LISTO CON ADVERTENCIAS”.

| Check | Resultado observado |
|---|---|
| APP_VERSION | PASS |
| AUTH_USER | PASS |
| INVENTORY_CONTEXT | PASS |
| MASTER_SNAPSHOT | PASS |
| LOCAL_DATABASE | PASS |
| LOCAL_STORAGE | WARN — espacio libre no observable |
| BACKEND_CONNECTIVITY | PASS |
| DEVICE_TIME | PASS |
| CAMERA_AVAILABLE | PASS |
| CAMERA_PERMISSION | UNAVAILABLE — Google scanner no requiere permiso de cámara de INVEN3 |
| SCANNER_AVAILABLE | PASS |

La captura física demuestra además que el runtime ya no cae en el error genérico de Device Health y que el maestro remoto se hidrata correctamente a SQLite local.

## Defectos resueltos durante esta ejecución

- Carrera de apertura SQLite.
- Carrera de migraciones SQLite.
- Transacciones anidadas por uso incorrecto de `execute('BEGIN IMMEDIATE')`.
- Hidratación automática del maestro QA a SQLite.
- Normalización UTC de timestamps PostgreSQL del maestro.
- Overflow móvil de controles de Supervisión.
- Etiqueta diagnóstica ambigua “Entorno: Production”.
- Insets Android 15/16 para mantener el WebView fuera de las barras del sistema.

## Hallazgo offline/sync en hardware

Durante el conteo físico real se generaron dos registros sintéticos `A-01-03 / 001234 / 1` en el Xiaomi. El servidor recibió ambos exactamente una vez, pero el cliente mostró uno como `SYNC_RESPONSE_INCOMPATIBLE` y otro como `PENDING`.

La verificación directa en `INVEN3-QA` confirmó:

- ambos `client_count_id` fueron insertados una sola vez en `count_records`;
- mismo usuario QA ANALISTA y mismo dispositivo físico;
- no hubo pérdida ni duplicación remota;
- el defecto estaba en el parser cliente de `received_at timestamptz`.

Se preparó y ejecutó forward-fix cliente para normalizar timestamps PostgreSQL de ACK a UTC y migración SQLite v6 que reencola exclusivamente falsos `SYNC_RESPONSE_INCOMPATIBLE`. El replay conservó `client_count_id` y resolvió como `ALREADY_ACCEPTED`.

Resultado físico posterior al upgrade in-place:

- ambos conteos aparecen localmente como `Confirmado en servidor`;
- consulta operativa remota muestra ambos registros recibidos;
- verificación SQL directa confirmó exactamente una fila por cada `client_count_id`;
- no se creó ningún duplicado durante el replay;
- el primer registro conservó server id `2d027b8f-0e82-43e4-810d-98b14e237d05`;
- el segundo registro conservó server id `79f35546-00ee-4654-99e4-61dfb1d435bd`.

Este incidente queda cerrado como PASS de recuperación/idempotencia del defecto descubierto; la prueba offline completa con cierre/reinicio físico continúa pendiente.

## Hallazgo de fallback offline tras FULL

Después de obtener `FULL = READY_WITH_WARNINGS` en línea, al activar modo avión y refrescar Health la captura quedó bloqueada. La inspección mostró que Supabase Auth representa la caída de red como `AuthRetryableFetchError`; el clasificador local sólo reconocía `TypeError: Failed to fetch`, por lo que el error se convertía en `AMBIGUOUS`, limpiaba la cache de contexto y bloqueaba la captura fail-closed.

Primer forward-fix:

- `AuthRetryableFetchError` se clasifica como `UNAVAILABLE`;
- con cache válida y mismo usuario local, `resolveCountingContext` puede retornar `OFFLINE`;
- la cache no se elimina durante esta caída de red explícitamente retryable.

La repetición física del 2026-09-27 expuso un segundo defecto: cuando el access token está vencido, `supabase.auth.getSession()` intenta refresh; sin red devuelve sesión nula + error retryable aunque Supabase conserve la sesión persistida. INVEN3 usaba ese resultado como identidad local, por lo que `AUTH_USER` fallaba y `INVENTORY_CONTEXT`/`MASTER_SNAPSHOT` caían en cascada.

Segundo forward-fix:

- la identidad local (sólo UUID de usuario, nunca token) se persiste separadamente al autenticar/recuperar sesión;
- un refresh retryable sin red puede reutilizar exclusivamente ese UUID persistido;
- una respuesta autoritativa de sesión inexistente no reutiliza la identidad;
- `SIGNED_OUT` y logout explícito eliminan la identidad persistida;
- el arranque offline puede mantener `AuthenticatedRuntime` aun cuando el JWT requiera refresh remoto;
- autorización de inventario continúa dependiendo del último contexto server-authoritative cacheado y la coincidencia de usuario;
- tests cubren boot offline, refresh retryable y no-reutilización ante sesión realmente ausente.

El Health esperado después de una verificación online válida pasa a `READY_OFFLINE`, con backend/hora en WARN no bloqueante.

## Pendientes de esta ejecución

- Persistencia offline restante: validar explícitamente PENDING tras cierre/reapertura y reinicio físico completo; la reconexión/sync/idempotencia ya están PASS.
- Capacidad offline: 39 / 40 / 45 / 50.
- Scanner físico: QR, Code128 y GS1-128/EAN-128 cuando exista muestra; cancelación sin autosave.
- UI restante: teclado, barra gestual, orientación, fuentes grandes/textos largos.
- Rendimiento físico reproducible.
- Determinar cobertura de categoría (estándar/grande/alta densidad) sin inferir resultados hacia otras categorías.
- Android angosto y tablet Android permanecen sin ejecución física.

No declarar `ANDROID_PHYSICAL = PASS` hasta cerrar el checklist obligatorio.


### Repetición 2026-09-27 — proceso Android destruido / reinicio offline

La prueba con el proceso de app destruido mostró un tercer matiz del mismo defecto: después de reiniciar el proceso en modo avión, Supabase Auth puede exponer temporalmente `getSession() => { session: null, error: null }` aunque la identidad durable local y el contexto autorizado sigan disponibles. El runtime quedaba dentro de la app pero `AUTH_USER` pasaba a FAIL; `INVENTORY_CONTEXT` y `MASTER_SNAPSHOT` fallaban en cascada.

Forward-fix:

- un `session: null` transitorio ya no borra ni invalida el UUID local durable;
- `getLocalSessionUserId()` reutiliza ese UUID para continuidad offline;
- logout explícito / evento `SIGNED_OUT` siguen limpiando identidad y contexto;
- el backend sigue siendo autoritativo al reconectar y puede bloquear el contexto;
- se agregan tests para reinicio offline con sesión nula sin error.


## PASS físico — READY_OFFLINE — 2026-09-27

Evidencia física en Xiaomi 15T después del rediseño de autoridad offline:

- estado general: `DISPOSITIVO LISTO PARA INVENTARIO OFFLINE`;
- modo Health: `LIGHT`;
- `APP_VERSION = PASS`;
- `AUTH_USER = PASS` — “Identidad autorizada disponible localmente”;
- `INVENTORY_CONTEXT = PASS` — inventario abierto autorizado;
- `MASTER_SNAPSHOT = PASS` — maestro local disponible;
- `LOCAL_DATABASE = PASS`;
- `LOCAL_STORAGE = WARN` — no bloqueante, espacio libre no observable;
- la app permanece operativa sin depender de `supabase.auth.getSession()` durante la caída de red.

Este resultado cierra el defecto estructural de identidad/autorización offline descubierto durante F9B. El modelo activo queda: servidor autoritativo online + lease de autorización persistido en SQLite para continuidad offline + invalidación en logout/denegación autoritativa.

HEAD observado al registrar evidencia: `bb063aeb3fd5c917c271e27027ed43746b95660a`.

Pendiente para cerrar el gate físico: crear un conteo offline, comprobar persistencia tras cierre/reapertura y reinicio completo del dispositivo, reconectar y confirmar sincronización idempotente de una sola fila remota.


## PASS físico — persistencia/sincronización offline — 2026-09-27

Después de alcanzar `READY_OFFLINE`, se creó un conteo sintético offline `A-01-03 / 001234 / 1`, permaneció pendiente localmente y luego se sincronizó correctamente al recuperar conectividad.

Verificación remota en `INVEN3-QA`:

- `client_count_id`: `64ff0aca-db3b-4116-a3d3-d93cb77c1cd2`;
- `server id`: `e42a4944-17b9-467b-ab2c-3f8757cd25ae`;
- ubicación: `A-01-03`;
- código: `001234`;
- cantidad: `1`;
- captura: `2026-09-27T14:10:14.094Z`;
- recepción: `2026-09-27T14:12:11.943973Z`;
- filas remotas para el mismo `client_count_id`: exactamente `1`;
- duplicados: `0`.

Resultado: PASS de sincronización post-offline e idempotencia remota para este conteo físico.


## Automatización de capacidad/offline — 2026-09-27

Se agregó un runner único:

`npm run certify:f9b:auto-offline`

Cobertura automática:

- typecheck;
- persistencia lógica de 50 conteos a través de reapertura de storage;
- caída transitoria y recuperación;
- sincronización por lotes 20 + 20 + 10;
- estados de capacidad 39 NORMAL / 40 WARNING / 45 CRITICAL / 50 BLOCKED;
- bloqueo del conteo 51 conservando exactamente 50 pendientes;
- UI de capacidad y botón GUARDAR bloqueado en 50;
- outbox/sync/idempotencia de cliente;
- boot/autorización offline;
- scanner health no bloqueante.

Esta automatización elimina la necesidad de generar manualmente 50 conteos sólo para validar la lógica de capacidad. La certificación física conserva únicamente los checks irreducibles de hardware: persistencia tras reinicio real del dispositivo y scanner/cámara/UI física.


## PASS automático — F9B offline/capacidad — 2026-09-27

Ejecución local confirmada por operador:

- comando: `npm run certify:f9b:auto-offline`;
- Test Files: `7 passed (7)`;
- Tests: `42 passed (42)`;
- fallos: `0`.

Cobertura cerrada automáticamente: capacidad 39/40/45/50, bloqueo de conteo 51, persistencia lógica de outbox, recuperación tras caída, sync por lotes, auth boundary offline y scanner health contractual.

HEAD de rama al registrar evidencia: `822e0d13abfc3130b626216bd4c3f92b3d54d1af`.


## Runner integral F9B — 2026-09-27

Se agregó un runner integral para eliminar ejecución manual repetitiva:

`npm run certify:f9b:complete`

Secuencia automatizada:

1. typecheck;
2. todos los unit tests;
3. E2E responsive/accesibilidad;
4. regresión visual;
5. build web;
6. conexión ADB/Playwright con un Android físico;
7. activación de modo avión (cuando ADB lo permite) y validación `READY_OFFLINE`;
8. creación de conteo sintético offline por WebView;
9. persistencia tras force-stop/reapertura;
10. reboot físico Android por ADB y verificación post-boot;
11. validación de teclado/viewport y overflow portrait/landscape;
12. reconexión y sincronización del outstanding;
13. apertura/cancelación del scanner nativo verificando cero autosave;
14. capturas y `evidence.json` bajo `artifacts/f9b-android-device/<run-id>`.

Limitación irreducible: una lectura óptica real de QR/Code128 sigue requiriendo presentar físicamente un código a la cámara. El runner sí certifica disponibilidad, apertura/cancelación y ausencia de autosave; el adaptador/restoration están cubiertos además por tests unitarios.


## PASS físico — scanner Android — 2026-09-27

Evidencia física aportada por operador en Xiaomi 15T:

- scanner nativo abre correctamente;
- lectura óptica real realizada correctamente;
- el código escaneado es reconocido por INVEN3;
- flujo operativo reportado como funcional;
- no se observó bloqueo del formulario ni fallo del scanner durante la prueba física.

Resultado: `SCANNER_PHYSICAL = PASS`.

Este PASS complementa la cobertura automática del adaptador, disponibilidad, restauración y cancelación sin autosave. La certificación óptica real queda cubierta por ejecución física en hardware.


## PASS parcial físico + corrección de reintento manual — 2026-09-27

Última ejecución física confirmó:

- `READY_OFFLINE = PASS`;
- `CREATE_PENDING = PASS`;
- `PROCESS_RESTART_PERSISTENCE = PASS`;
- `USER_UNLOCKED_POST_REBOOT = PASS`;
- `AIRPLANE_MODE_POST_REBOOT = PASS`;
- `PHYSICAL_REBOOT_PERSISTENCE = PASS`;
- `KEYBOARD_LAYOUT = PASS`;
- `PORTRAIT_OVERFLOW = PASS`;
- `LANDSCAPE_OVERFLOW = PASS`.

Hallazgo final: un conteo que había fallado por modo avión quedaba `FAILED` con `next_retry_at` futuro. El botón manual `SINCRONIZAR AHORA` compartía el selector del auto-sync y respetaba ese backoff, por lo que podía no reclamar inmediatamente el registro aunque la conectividad ya hubiese vuelto.

Corrección aplicada:

- auto-sync mantiene el backoff exponencial;
- sync manual usa `forceRetry=true` y reclama inmediatamente `FAILED` aunque `next_retry_at` sea futuro;
- SQLite y Dexie implementan el mismo contrato;
- se agregó regresión automática de dominio/UI;
- el runner físico espera conectividad real con Supabase y expone diagnóstico detallado de pendientes/rechazos.

Runner fresco de una sola orden:

`npm run certify:f9b:android-fresh`

Este comando valida tests offline relevantes, recompila, sincroniza Capacitor, genera APK debug, instala con `adb install -r` preservando SQLite y ejecuta la certificación física.
