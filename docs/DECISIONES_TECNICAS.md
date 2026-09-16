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
