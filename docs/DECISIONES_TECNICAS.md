# Decisiones técnicas

## ADR-001 — Aplicación React/Vite con Capacitor local

- **Decisión:** React + TypeScript estricto + Vite; Capacitor 8 con `webDir: dist` e identificador `com.lockowom.inven3`.
- **Motivo:** un único bundle local para Android, iOS y Cloudflare Pages.
- **Alternativas:** aplicación web remota dentro de WebView.
- **Consecuencias:** todo cambio web debe ejecutar `cap sync` antes del build nativo.
- **Estado:** aceptada.

## ADR-002 — Persistencia detrás de un puerto y SQLite Capacitor 8

- **Decisión:** `LocalDatabase` abstrae SQLite y la futura capa web Dexie. El adaptador nativo usa `@capacitor-community/sqlite` 8.1.1.
- **Motivo:** 8.1.1 declara compatibilidad con `@capacitor/core >=8.0.0` y mantiene al dominio desacoplado de Capacitor y del motor de almacenamiento.
- **Alternativas:** SQLite 7.0.3 (descartada: no corresponde al major de Capacitor 8); importar el plugin desde casos de uso.
- **Consecuencias:** los adaptadores deben preservar transacciones y semántica de errores. La PoC nativa debe certificarse en Android e iOS reales antes de implementar conteos.
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
