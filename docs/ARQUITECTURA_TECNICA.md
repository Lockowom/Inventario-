# Arquitectura técnica — Fase 0

INVEN3 es una aplicación React/TypeScript construida con Vite. El bundle estático `dist/` sirve la web en Cloudflare Pages y es el bundle local que Capacitor incorpora a Android e iOS; la app instalada no carga una URL externa al iniciar.

## Capas y responsabilidades

- `src/domain`: contratos Zod y tipos de negocio compartibles. No importa React, Capacitor, Dexie ni Supabase.
- `src/features`: casos de uso y UI por capacidad. Se mantienen vacíos hasta que exista una necesidad de Fase 1+.
- `src/storage`: puertos de persistencia. `LocalDatabase` evita que el dominio dependa de un plugin nativo; `mobile-sqlite` adapta `@capacitor-community/sqlite` y `web-indexeddb` aloja Dexie.
- `src/services`: adaptadores de infraestructura remota, incluido Supabase con variables públicas de Vite.
- `src/sync` y `src/scanner`: reservados para motores y adaptadores futuros, sin reglas de captura implementadas en esta fase.

## Persistencia y flujo de datos

La futura captura seguirá: validación con contratos compartidos → transacción local (SQLite móvil o IndexedDB web) → confirmación local → motor de sincronización → RPC protegida en Supabase. Las operaciones críticas no se implementarán como secuencias de mutaciones desde el cliente.

SQLite se implementa mediante `CapacitorSqliteDatabase`; `runSqliteProofOfConcept` cubre creación de base y tabla, escritura, actualización, lectura, transacción, cierre, reapertura y persistencia. En una prueba real Android/iOS debe ejecutarse contra la misma base nativa antes de promoverla a la capa de conteos.

## Seguridad

El cliente usa solo `VITE_SUPABASE_URL` y `VITE_SUPABASE_ANON_KEY`. La clave `service_role` no tiene lugar en web, Android o iOS. Supabase será RLS-first; los cortes, rectificaciones, ciclo de vida y sincronización se implementarán mediante RPC/Functions autorizadas y auditables en fases posteriores.

## Diseño y plataformas

Los tokens CSS centralizan spacing, tipografía, radios, alturas de controles, objetivos táctiles y safe areas. El layout parte de una columna, no permite overflow horizontal y agrega una segunda columna desde 600px. Capacitor usa el identificador `com.lockowom.inven3`.

### SQLite y iOS

La base móvil usa `@capacitor-community/sqlite` 8.1.1, cuya peer dependency declara Capacitor Core `>=8.0.0`; está alineada con Capacitor 8.5.2 del proyecto. La distribución del plugin incluye tanto `CapacitorCommunitySqlite.podspec` (CocoaPods) como `Package.swift` (Swift Package Manager). Por lo tanto, CocoaPods no es un requisito técnico del plugin.

El proyecto iOS generado por Capacitor 8 utiliza Swift Package Manager (`ios/App/CapApp-SPM`). Después de `npx cap sync ios`, el paquete del plugin se incluye desde esa integración. El deployment target efectivo es iOS 15.0: coincide con `Package.swift`, el podspec del plugin y el proyecto Xcode generado. No se adoptan dependencias CocoaPods para INVEN3 en Fase 0.
