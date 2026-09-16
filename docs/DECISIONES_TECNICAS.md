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

## ADR-005 — Gestor de paquetes iOS: Swift Package Manager

- **Decisión:** usar Swift Package Manager, que Capacitor 8 genera para el proyecto iOS (`CapApp-SPM`).
- **Motivo:** SQLite 8.1.1 distribuye `Package.swift` y Capacitor 8 puede incorporar el plugin mediante SPM. Se evita introducir CocoaPods sin necesidad técnica.
- **Alternativas:** CocoaPods, también soportado por el podspec del plugin.
- **Consecuencias:** el target mínimo de INVEN3 iOS es 15.0, consistente con el manifiesto SPM, podspec y Xcode project generados. Cualquier migración futura a CocoaPods requerirá un ADR propio, no una suposición de incompatibilidad.
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
- **Consecuencias:** ADMIN realiza importación masiva; ANALISTA asignado sólo resuelve SKU excepcionales auditados. La metadata versionada con fingerprint determinista permite detección de actualización sin Realtime.
- **Estado:** aceptada.
