# Decisiones técnicas

## ADR-001 — Aplicación React/Vite con Capacitor local

- **Decisión:** React + TypeScript estricto + Vite; Capacitor 8 con `webDir: dist` e identificador `com.lockowom.inven3`.
- **Motivo:** un único bundle local para Android, iOS y Cloudflare Pages.
- **Alternativas:** aplicación web remota dentro de WebView.
- **Consecuencias:** todo cambio web debe ejecutar `cap sync` antes del build nativo.
- **Estado:** aceptada.

## ADR-002 — Persistencia detrás de un puerto y SQLite Capacitor 8

- **Decisión:** los repositorios/puertos del dominio son el contrato compartido entre plataformas. `SqliteDatabase` queda como un puerto técnico privado de `storage/mobile-sqlite`; Dexie será un adaptador web, no un emulador SQL. El adaptador nativo usa `@capacitor-community/sqlite` 8.1.1.
- **Motivo:** los casos de uso no deben conocer strings SQL ni APIs de Dexie. Los repositorios permiten sostener la misma semántica de negocio con infraestructuras de almacenamiento diferentes.
- **Alternativas:** exponer una interfaz SQL común para ambas plataformas (descartada: acopla futuros casos de uso al SQL); SQLite 7.0.3 (descartada: no corresponde al major de Capacitor 8).
- **Consecuencias:** cada agregado tendrá un repositorio de dominio en su fase correspondiente y adaptadores SQLite/Dexie que preserven sus invariantes. La PoC nativa debe certificarse en Android e iOS reales antes de implementar conteos.
- **Estado:** aceptada.

## ADR-005 — Gestor de paquetes iOS: CocoaPods para ML Kit

- **Decisión:** usar CocoaPods en `ios/App/Podfile` y eliminar la integración `CapApp-SPM`; el target de proyecto y Pods es iOS 15.5.
- **Motivo:** SQLite 8.1.1 admite tanto CocoaPods como SPM, pero el adaptador oficial ML Kit `@capacitor-mlkit/barcode-scanning` 8.2.1 para Capacitor 8 sólo admite CocoaPods en iOS. Esta es una decisión de integración del proyecto, no una limitación de SQLite.
- **Alternativas:** conservar SPM y elegir un escáner distinto basado en AVFoundation/Vision; descartada en Fase 3 para mantener el adaptador ML Kit requerido.
- **Consecuencias:** `cap sync ios` actualiza el Podfile; en macOS se debe ejecutar `pod install` y abrir `App.xcworkspace`. La certificación física de cámara no se suplanta desde Windows.
- **Estado:** aceptada.

## ADR-011 — Capacidad local atómica y contexto de captura autorizado

- **Decisión:** la reserva de un conteo `PENDING` se realiza únicamente mediante `savePendingWithCapacity` dentro de una transacción del adaptador. El runtime de captura se crea sólo desde Auth, perfil activo y una respuesta RLS que contenga exactamente un inventario asignado `ABIERTO`.
- **Motivo:** separar `count` de `save` permitía superar 50 con llamadas concurrentes; un literal TypeScript no demuestra que el inventario siga autorizado y abierto.
- **Consecuencias:** los umbrales 40/45/50 son visibles y textuales; en 50 se bloquea guardar sin borrar datos. La verificación de contexto ocurre al entrar y la escritura física no depende de red. La selección explícita entre múltiples inventarios pertenece a la navegación posterior.
- **Estado:** aceptada.

## ADR-012 — Last-known authorized counting context

- **Decisión:** persistir únicamente la última autorización de captura que el servidor verificó correctamente (`user_id`, `inventory_id`, `ABIERTO`, `verified_at`) mediante el puerto `CountingContextRepository`, con adaptadores SQLite v4 y Dexie v4.
- **Motivo:** permitir que un reinicio sin conectividad recupere una operación previamente autorizada, sin convertir almacenamiento local en una nueva decisión de autorización.
- **Regla de autoridad:** el arranque es server-first. `AUTHORIZED` reemplaza la copia; `NOT_AUTHORIZED` o `AMBIGUOUS` bloquean y la limpian; sólo `UNAVAILABLE` puede usar una copia para el mismo usuario de sesión local. Auth se clasifica con su propio estado/código y PostgREST con el `status` de respuesta más `error.code`; los fallos no reconocidos son `AMBIGUOUS`, nunca offline. Logout siempre la borra.
- **Consecuencias:** no se persisten tokens ni secretos y un maestro local sigue siendo requisito de captura. Durante una desconexión total se opera con el último `ABIERTO` confirmado, por lo que un cierre remoto concurrente sólo se conocerá al recuperar conectividad. La Fase 4 deberá resolver los pendientes frente a la autoridad actual del servidor.
- **Estado:** aceptada.

## ADR-003 — Validaciones compartibles Zod

- **Decisión:** Zod define contratos de dominio reutilizables.
- **Motivo:** reduce divergencia entre cliente y backend.
- **Alternativas:** validadores separados por capa.
- **Consecuencias:** los contratos compatibles deberán reutilizarse o replicarse de forma verificable en Supabase.
- **Estado:** aceptada.

## ADR-004 — Seguridad Supabase RLS-first

- **Decisión:** variables públicas únicamente en cliente; mutaciones críticas por RPC/Functions con RLS y autorización del servidor.
- **Motivo:** proteger integridad, roles y auditoría.
- **Alternativas:** acceso cliente directo a tablas sensibles.
- **Consecuencias:** el schema de Fase 1 requiere políticas y RPC antes de la UI operacional.
- **Estado:** aceptada.

## ADR-006 — Modelo PostgreSQL y ciclo de vida protegido

- **Decisión:** modelar entidades operacionales en migraciones forward-only, con UUID, `timestamptz`, RLS y constraints de base. Las transiciones de inventario se ejecutan exclusivamente mediante RPC transaccionales.
- **Motivo:** la integridad, la auditoría y el control de roles no pueden depender de una UI ni de llamadas cliente múltiples.
- **Alternativas:** actualizaciones directas de estado desde frontend; roles en metadata de Auth; borrado operacional. Todas descartadas por seguridad y trazabilidad.
- **Consecuencias:** un Supabase local es necesario para ejecutar pgTAP y generar tipos. Ninguna migración ha sido aplicada a un proyecto remoto.
- **Estado:** aceptada.

## ADR-007 — Integridad compuesta, helpers privados y certificación local

- **Decisión:** las relaciones que pueden cruzar inventarios se protegen con claves foráneas compuestas; los helpers de autorización viven en `app_private`; y CI arranca Supabase local para resetear migraciones, cargar el seed, ejecutar pgTAP y los asesores de seguridad.
- **Motivo:** una FK simple puede aceptar combinaciones válidas de forma aislada pero pertenecientes a inventarios distintos. Los helpers `SECURITY DEFINER` no deben ser una API pública ni heredarse por `anon`.
- **Alternativas:** validar estas combinaciones solo en TypeScript; ubicar helpers en `public`; omitir la prueba de base de datos en CI. Descartadas porque no certifican integridad ni privilegios reales de PostgreSQL.
- **Consecuencias:** `count_records`, cortes, rectificaciones y archivos deben conservar sus relaciones compuestas; las funciones públicas de ciclo de vida son las únicas RPC concedidas a `authenticated`. CI no enlaza ni aplica cambios a Supabase remoto.
- **Estado:** aceptada.

## ADR-008 — Snapshot de maestro y distribución offline transaccional

- **Decisión:** cargar CSV/XLSX en preview de cliente, confirmar el snapshot por RPC atómica y distribuirlo con el puerto `MasterSkuRepository` hacia SQLite o Dexie.
- **Motivo:** el archivo no es verdad final; la base debe validar autorización, estado, duplicados y auditoría. El reemplazo local debe preservar el snapshot anterior si falla la descarga.
- **Alternativas:** insertar filas desde el cliente; SQL común para SQLite y Dexie; mutar el maestro abierto. Descartadas por integridad, acoplamiento y trazabilidad.
- **Consecuencias:** ADMIN realiza importación masiva; ANALISTA asignado sólo resuelve SKU excepcionales auditados en estado `ABIERTO`. La metadata versionada con fingerprint determinista permite detección de actualización sin Realtime. Cada mutación de maestro o ciclo de vida bloquea la fila del inventario mediante `FOR UPDATE`, y el reemplazo offline verifica filas, fingerprint y estabilidad de metadata antes de persistir.
- **Estado:** aceptada.

## ADR-009 — Runner SQLite forward-only

- **Decisión:** las migraciones locales se declaran como una secuencia versionada y se aplican una por una en transacciones, con `PRAGMA user_version` como cursor.
- **Motivo:** asignar una versión tras `CREATE TABLE IF NOT EXISTS` no demuestra que el schema llegó íntegro ni permite evolucionar con seguridad hacia conteos y sincronización.
- **Consecuencias:** una migración fallida conserva la versión previa; una base creada por una app más nueva se rechaza de forma controlada. Las versiones futuras se agregan sin reescribir las anteriores.
- **Estado:** aceptada.

## ADR-010 — Conteo offline detrás de un puerto semántico

- **Decisión:** `CountRepository` expresa identidad local de dispositivo, guardado idempotente por UUID, búsqueda, listado propio y capacidad pendiente. `savePhysicalCount` es el único caso de uso de captura; SQLite y Dexie lo implementan sin exponer SQL/Dexie al dominio.
- **Motivo:** preservar registros offline y mantener una frontera común antes de implementar la sincronización. El éxito de UI sólo puede seguir a una escritura local transaccional.
- **Alternativas:** SQL en componentes React; emulador SQL sobre Dexie; guardar directamente desde el escáner. Descartadas por acoplamiento, fragilidad y pérdida de trazabilidad.
- **Consecuencias:** Fase 3 no incluye RPC de conteos, reintentos remotos ni eliminación. El siguiente motor de sincronización deberá consumir los `client_count_id` persistidos y respetar los estados existentes.
- **Estado:** aceptada.

## ADR-011 — Outbox local con ACK explícito e idempotencia de servidor

- **Decisión:** Fase 4 usa `PENDING → SYNCING → CONFIRMED|FAILED|REJECTED`, reclama lotes de máximo 20 dentro de la transacción local y confirma sólo un ACK validado de `sync_counts`.
- **Motivo:** un timeout puede ocurrir después de que PostgreSQL insertó. El `client_count_id` único y la comparación inmutable permiten reintentar sin duplicar ni sobrescribir.
- **Alternativas:** marcar confirmado antes de la respuesta; confiar en un booleano cliente; reintentar con un UUID nuevo. Descartadas por pérdida o duplicación de conteos.
- **Consecuencias:** se conserva historial local de error e intento, se recuperan reclamos `SYNCING` abandonados y una respuesta parcial deja registros en `FAILED` con backoff y jitter.
- **Estado:** aceptada.

## ADR-012 — Registro opaco de dispositivo por usuario e instalación

- **Decisión:** almacenar una inscripción UUID local por usuario, derivar plataforma desde Capacitor y registrar/actualizar exclusivamente por RPC protegida.
- **Motivo:** la correlación de pendientes y auditoría necesita un origen estable sin reutilizar la propiedad de otro usuario ni recolectar identificadores físicos.
- **Alternativas:** una identidad única de instalación compartida entre usuarios; serial/IMEI; campos de plataforma editables en UI. Descartadas por seguridad y privacidad.
- **Consecuencias:** las guardas de freeze se actualizan por estado conocido del dispositivo; `CONGELADO` sigue siendo autoridad final y rechaza el registro entrante.
- **Estado:** aceptada.
## Fase 4 — Outbox independiente de captura

Se decide que el outbox es propiedad durable del usuario/dispositivo y no de la pantalla de conteo. `SyncCoordinator` se ejecuta al inicio con sesión local válida y descubre inventarios con trabajo pendiente; `CaptureRuntime` permanece restringido a `ABIERTO`. Los fallos de sync se clasifican en transitorios o terminales fail-closed: sólo los transitorios programan retry. Las señales de freeze se calculan por `(inventory_id, device_id)`.

## ADR-013 — Supervisión mediante read models protegidos

- **Decisión:** Fase 5 expone modelos de lectura mínimos por RPC y mantiene las tablas de conteos/dispositivos detrás de RLS. ADMIN supervisa globalmente, ANALISTA sólo inventarios asignados y CONTADOR recibe exclusivamente su resumen propio.
- **Motivo:** una vista cliente sobre tablas operacionales puede ampliar accidentalmente la superficie de datos y convertir telemetría histórica en una afirmación de presencia. El servidor es quien distingue captura física de recepción.
- **Alternativas:** consultas directas desde React; un dashboard con datos sintéticos; una tabla de presencia o heartbeat frecuente; una restricción única para series. Descartadas por exposición, semántica incorrecta, costo operativo o bloqueo indebido.
- **Consecuencias:** los resultados se ordenan por cursor determinista y los filtros se ejecutan en PostgreSQL. `last_seen_at`, `last_sync_at` y guardas pendientes se etiquetan como observaciones conocidas. La serie repetida es una alerta no bloqueante y las partidas repetidas no se alertan. El refresco de 60 segundos visible no escribe datos ni usa Realtime.
- **Estado:** aceptada.

## ADR-014 — Actividad de dispositivo acotada por inventario

- **Decisión:** conservar `sync_devices` como observación global y usar `app_private.inventory_device_activity` exclusivamente para el panel por inventario.
- **Motivo:** un usuario puede trabajar con dispositivos distintos en inventarios A y B; deducir estado de A desde todos sus dispositivos mezcla evidencia y puede marcar actividad falsa.
- **Consecuencias:** el modelo se actualiza sólo en operaciones protegidas de Fase 4, no hay heartbeat nuevo, `known_devices` cuenta sólo evidencia del inventario y los filtros de fecha llevan límites absolutos derivados del día local del operador. La búsqueda usa borrador/aplicado, por lo que un cursor nunca combina filtros distintos.
- **Estado:** aceptada.

## Riesgo conocido — dependencias moderadas de desarrollo

`npm audit` identifica cinco avisos moderados: `@capacitor/cli` directo a través de `xcode` y `uuid`; y `vitest` directo a través de `@vitest/mocker`. La actualización de Vitest disponible es `5.0.1`, un major incompatible que no se aplica durante esta corrección. La ruta de `uuid` depende de `xcode`, transitiva de Capacitor CLI; existe fix, pero se evaluará al alinear de forma conjunta el conjunto Capacitor 8, no aislando CLI/Core. Son dependencias de herramientas de build/test, no claves ni código de ejecución de la app; se mantiene seguimiento sin usar `--force`.

## ADR-015 — Corte idempotente como snapshot inmutable antes de archivo

- **Decisión:** `create_cut` recibe un `request_id` UUID único por inventario, se serializa con `app_private.lock_inventory`, asigna `export_seq` determinista por `(received_at, id)` e inserta los snapshots en una misma transacción antes de marcar `SNAPSHOT_CREATED`.
- **Motivo:** doble clic, timeout posterior al commit y sincronización tardía no pueden producir cortes solapados ni reconstrucciones ambiguas. Un archivo futuro debe leer exactamente la evidencia que fue cortada, no filas vivas.
- **Alternativas:** cortar desde React por lote; exigir cero pendientes offline; reordenar por orden físico; recalcular exportación desde `count_records`; generar XLSX en esta fase. Descartadas por pérdida, acoplamiento, no determinismo o adelanto de Fase 7.
- **Consecuencias:** ABIERTO y CERRADO permiten cortes parciales; las llegadas tardías quedan sin corte para el siguiente. El conteo con `cut_id`/`export_seq` ya no acepta corrección normal. Fase 6 no tiene Storage, hash final, descarga ni rectificación post-corte.
- **Estado:** aceptada.

## ADR-016 — Corrección canónica preservando idempotencia local

- **Decisión:** los cambios físicos posteriores a recepción se hacen sólo por `correct_uncut_count`, validado contra el maestro y registrado en `count_revisions`/`audit_events`.
- **Motivo:** mutar el payload local después de comenzar sync puede reutilizar el mismo UUID con contenido distinto y producir un conflicto ambiguo.
- **Consecuencias:** el outbox conserva identidad y contenido originales; corrección y corte comparten bloqueo de inventario, por lo que un snapshot ve una versión completa o bloquea la corrección. Las series duplicadas siguen siendo alerta no bloqueante.
- **Estado:** aceptada.

### Aclaración Fase 6 — payload original de ingesta

La corrección canónica no redefine el contenido asociado a `client_count_id`. Se decide reconstruir el payload original desde `count_revisions.old_values` de la primera revisión, con fallback a `count_records` cuando aún no hay revisiones. Evita una columna duplicada y permite que un ACK perdido conserve `ALREADY_ACCEPTED` sin aceptar como replay el payload corregido. Los campos de identidad/recepción continúan obteniéndose de la fila inmutable de `count_records`.
