# Arquitectura técnica — Fases 0 a 3

INVEN3 es una aplicación React/TypeScript construida con Vite. El bundle estático `dist/` sirve la web en Cloudflare Pages y es el bundle local que Capacitor incorpora a Android e iOS; la app instalada no carga una URL externa al iniciar.

## Capas y responsabilidades

- `src/domain`: contratos Zod, tipos y puertos semánticos de negocio compartibles. No importa React, Capacitor, SQL, Dexie ni Supabase.
- `src/features`: UI por capacidad. `counting` consume contratos y puertos semánticos; nunca SQL, Dexie ni el plugin nativo.
- `src/storage`: adaptadores de infraestructura. `mobile-sqlite` contiene el puerto técnico `SqliteDatabase` y el adaptador de `@capacitor-community/sqlite`; `web-indexeddb` aloja Dexie. Ninguno es un contrato de dominio.
- `src/services`: adaptadores de infraestructura remota, incluido Supabase con variables públicas de Vite.
- `src/scanner`: adaptador de cámara para QR y Code 128. Sólo devuelve un valor al formulario; no busca SKU, valida ni guarda.
- `src/sync`: reservado. Fase 3 no llama RPC ni sincroniza conteos.

## Persistencia y flujo de datos

La futura captura seguirá: validación con contratos compartidos → repositorio de dominio → adaptador local (SQLite móvil o IndexedDB/Dexie web) → confirmación local → motor de sincronización → RPC protegida en Supabase. Las operaciones críticas no se implementarán como secuencias de mutaciones desde el cliente.

```text
DOMAIN / USE CASES
        ↓
repositories / ports
        ↓
 ┌──────┴──────┐
SQLite        Dexie
mobile         web
```

Los repositorios del dominio son el contrato compartido real: expresan operaciones sobre entidades, no SQL ni APIs Dexie. `SqliteDatabase` es deliberadamente un detalle de bajo nivel exclusivo de `storage/mobile-sqlite`, utilizado por la PoC. Las futuras implementaciones de repositorios podrán usar SQLite o Dexie sin exponer strings SQL a casos de uso.

SQLite se implementa mediante `CapacitorSqliteDatabase`; `runSqliteProofOfConcept` cubre creación de base y tabla, escritura, actualización, lectura, transacción, cierre, reapertura y persistencia. En una prueba real Android/iOS debe ejecutarse contra la misma base nativa antes de promoverla a la capa de conteos.

## Conteo físico local

`resolveCountingContext` construye el runtime sólo desde un usuario verificado por Auth, perfil activo y filas RLS de asignación/inventario; requiere exactamente un inventario `ABIERTO` y no acepta IDs editables ni literales creados por UI. La verificación remota es siempre la primera opción. Sólo si su resultado es `UNAVAILABLE`, el caso de uso puede leer `CountingContextRepository`, comprobar que su `user_id` coincide con la sesión local y reconstruir el runtime offline. `NOT_AUTHORIZED` y `AMBIGUOUS` limpian/bloquean, por lo que un cierre o una revocación conocida nunca cae silenciosamente a cache. La fila persistida contiene únicamente `user_id`, `inventory_id`, `ABIERTO` y `verified_at`, no secretos; logout también la elimina.

`savePhysicalCount` después opera offline: consulta únicamente `MasterSkuRepository` local y persiste a través de `CountRepository`. El contexto cacheado no sustituye el maestro: sin maestro local la pantalla continúa bloqueada. El contrato central Zod valida ubicación, tipo de control, cantidad, fecha y texto antes de construir un UUID `client_count_id`; `captured_at` se toma en el instante físico y la identidad lógica del dispositivo se conserva localmente. La UI sólo anuncia éxito tras completar la transacción SQLite/Dexie y conserva el borrador si hay un error.

La migración SQLite v3 agrega `local_device_identity` y `local_count_records`, con unicidad de `client_count_id`, cantidad positiva, control y estado de sincronización restringidos e índices de inventario, usuario, código, captura y estado. V4 agrega `local_counting_context`, de una sola fila activa y sin tokens. Dexie v4 tiene la misma representación semántica, no una capa que interprete SQL. El límite local es 50 registros `PENDING` por dispositivo; `savePendingWithCapacity` cuenta e inserta de forma atómica (`BEGIN IMMEDIATE` en SQLite, read-write en Dexie), por lo que no puede llegar a 51 por carrera. La UI muestra normal 0–39, advertencia 40–44, crítico 45–49 y bloqueo explícito en 50. Fase 3 no elimina registros para eludir ese límite.

## Seguridad

El cliente usa solo `VITE_SUPABASE_URL` y `VITE_SUPABASE_ANON_KEY`. La clave `service_role` no tiene lugar en web, Android o iOS. Supabase será RLS-first; los cortes, rectificaciones, ciclo de vida y sincronización se implementarán mediante RPC/Functions autorizadas y auditables en fases posteriores.

## Diseño y plataformas

Los tokens CSS centralizan spacing, tipografía, radios, alturas de controles, objetivos táctiles y safe areas. El lenguaje base es oscuro y de alto contraste, sin azul ni naranja como colores dominantes; success, warning y error conservan tokens diferenciados y accesibles. El layout parte de una columna, no permite overflow horizontal y agrega una segunda columna desde 600px. Capacitor usa el identificador `com.lockowom.inven3`.

### SQLite, escáner e iOS

La base móvil usa `@capacitor-community/sqlite` 8.1.1, cuya peer dependency declara Capacitor Core `>=8.0.0`; está alineada con Capacitor 8.5.2 del proyecto. La distribución del plugin incluye tanto `CapacitorCommunitySqlite.podspec` (CocoaPods) como `Package.swift` (Swift Package Manager). Por lo tanto, CocoaPods no es un requisito técnico del plugin.

El plugin SQLite 8.1.1 puede utilizar CocoaPods o Swift Package Manager. Sin embargo, el escáner seleccionado `@capacitor-mlkit/barcode-scanning` 8.2.1 soporta Capacitor 8 y requiere CocoaPods en iOS para ML Kit; no ofrece `Package.swift`. Por decisión de proyecto, `ios/App/Podfile` usa CocoaPods y el deployment target es iOS 15.5. El manifiesto declara cámara y modelo de barras Android; iOS declara `NSCameraUsageDescription`. `cap sync ios` verifica la configuración, mientras que `pod install` y la prueba de cámara real se ejecutan en macOS/Xcode.
