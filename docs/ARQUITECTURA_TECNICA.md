# Arquitectura técnica — Fases 0 a 6

INVEN3 es una aplicación React/TypeScript construida con Vite. El bundle estático `dist/` sirve la web en Cloudflare Pages y es el bundle local que Capacitor incorpora a Android e iOS; la app instalada no carga una URL externa al iniciar.

## Capas y responsabilidades

- `src/domain`: contratos Zod, tipos y puertos semánticos de negocio compartibles. No importa React, Capacitor, SQL, Dexie ni Supabase.
- `src/features`: UI por capacidad. `counting` consume contratos y puertos semánticos; nunca SQL, Dexie ni el plugin nativo.
- `src/storage`: adaptadores de infraestructura. `mobile-sqlite` contiene el puerto técnico `SqliteDatabase` y el adaptador de `@capacitor-community/sqlite`; `web-indexeddb` aloja Dexie. Ninguno es un contrato de dominio.
- `src/services`: adaptadores de infraestructura remota, incluido Supabase con variables públicas de Vite.
- `src/scanner`: adaptador de cámara para QR y Code 128. Sólo devuelve un valor al formulario; no busca SKU, valida ni guarda.
- `src/domain/sync`: orquesta el outbox contra un puerto `CountSyncGateway`; no importa Supabase, Capacitor, SQL ni Dexie.
- `src/services/supabase-sync-gateway.ts`: adaptador remoto que llama solamente RPC protegidas.

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

`resolveCountingContext` construye el runtime sólo desde un usuario verificado por Auth, perfil activo y filas RLS de asignación/inventario; requiere exactamente un inventario `ABIERTO` y no acepta IDs editables ni literales creados por UI. La verificación remota es siempre la primera opción. Auth y PostgREST se clasifican por separado: para Data API se conserva el `status` de la respuesta junto con el código estable `error.code`. Sólo 502/503/504 o una firma explícita de fallo de transporte permiten `UNAVAILABLE`; permiso/RLS (`42501`), schema (`42P01`, `42703`), contrato, errores 4xx y cualquier error desconocido son fail-closed como `NOT_AUTHORIZED` o `AMBIGUOUS`. Sólo `UNAVAILABLE` permite leer `CountingContextRepository`, comprobar que su `user_id` coincide con la sesión local y reconstruir el runtime offline. `NOT_AUTHORIZED` y `AMBIGUOUS` limpian/bloquean, por lo que un cierre o una revocación conocida nunca cae silenciosamente a cache. La fila persistida contiene únicamente `user_id`, `inventory_id`, `ABIERTO` y `verified_at`, no secretos; logout también la elimina.

`savePhysicalCount` después opera offline: consulta únicamente `MasterSkuRepository` local y persiste a través de `CountRepository`. El contexto cacheado no sustituye el maestro: sin maestro local la pantalla continúa bloqueada. El contrato central Zod valida ubicación, tipo de control, cantidad, fecha y texto antes de construir un UUID `client_count_id`; `captured_at` se toma en el instante físico y la identidad lógica del dispositivo se conserva localmente. La UI sólo anuncia éxito tras completar la transacción SQLite/Dexie y conserva el borrador si hay un error.

SQLite v5 agrega el outbox (`sync_started_at`, `next_retry_at`, `confirmed_at`, `server_count_id`, `last_sync_at`) y registros locales de dispositivo por usuario. Dexie v5 tiene el mismo significado, no una capa que interprete SQL. El límite de 50 cuenta todo registro local aún no terminal (`PENDING`, `SYNCING`, `FAILED`), así que un envío en curso o fallido no abre capacidad artificialmente. Sólo `CONFIRMED`/`REJECTED` liberan capacidad.

`SyncManager` recupera `SYNCING` abandonados, reclama atómicamente hasta 20 registros, ejecuta un único envío concurrente y cambia a `CONFIRMED` únicamente tras un ACK válido con UUID servidor y `received_at`. Un ACK parcial, inválido o un transporte fallido deja los restantes `FAILED` con backoff exponencial limitado y jitter; el contenido físico jamás se borra ni se reemplaza. El adaptador deriva `ANDROID`/`IOS`/`WEB` de Capacitor y el servidor revalida Auth, RLS, asignación, inventario, maestro y reglas de control.

## Seguridad

El cliente usa solo `VITE_SUPABASE_URL` y `VITE_SUPABASE_ANON_KEY`. La clave `service_role` no tiene lugar en web, Android o iOS. `register_sync_device`, `report_device_sync_state` y `sync_counts` son las únicas mutaciones de Fase 4; no hay INSERT/UPDATE directo de dispositivos ni conteos. La integración local de CI usa una credencial de servicio únicamente dentro de los contenedores efímeros para preparar el harness, nunca en el bundle ni contra un proyecto remoto.

## Diseño y plataformas

Los tokens CSS centralizan spacing, tipografía, radios, alturas de controles, objetivos táctiles y safe areas. El lenguaje base es oscuro y de alto contraste, sin azul ni naranja como colores dominantes; success, warning y error conservan tokens diferenciados y accesibles. El layout parte de una columna, no permite overflow horizontal y agrega una segunda columna desde 600px. Capacitor usa el identificador `com.lockowom.inven3`.

### SQLite, escáner e iOS

La base móvil usa `@capacitor-community/sqlite` 8.1.1, cuya peer dependency declara Capacitor Core `>=8.0.0`; está alineada con Capacitor 8.5.2 del proyecto. La distribución del plugin incluye tanto `CapacitorCommunitySqlite.podspec` (CocoaPods) como `Package.swift` (Swift Package Manager). Por lo tanto, CocoaPods no es un requisito técnico del plugin.

El plugin SQLite 8.1.1 puede utilizar CocoaPods o Swift Package Manager. Sin embargo, el escáner seleccionado `@capacitor-mlkit/barcode-scanning` 8.2.1 soporta Capacitor 8 y requiere CocoaPods en iOS para ML Kit; no ofrece `Package.swift`. Por decisión de proyecto, `ios/App/Podfile` usa CocoaPods y el deployment target es iOS 15.5. El manifiesto declara cámara y modelo de barras Android; iOS declara `NSCameraUsageDescription`. `cap sync ios` verifica la configuración, mientras que `pod install` y la prueba de cámara real se ejecutan en macOS/Xcode.

## Supervisión operacional — Fase 5

La supervisión es una capacidad de lectura y no es el origen de datos del conteo. `SupabaseSupervisionRepository` llama sólo a `get_inventory_supervision`, `search_inventory_counts` y `get_my_count_summary`; ningún componente React consulta directamente `count_records`, `sync_devices` o guardas de freeze. Las funciones fijan el `search_path`, exigen perfil activo y aplican el helper de autorización antes de retornar un modelo mínimo.

`get_inventory_supervision` y `search_inventory_counts` son exclusivos de ADMIN o ANALISTA asignado. El CONTADOR sólo invoca `get_my_count_summary`, limitado a sus propios conteos recibidos y pendientes conocidos. El panel usa `received_at` para “conteos recibidos” y `cantidad_contada` para “unidades contadas”; no calcula stock ni progreso, ni presenta diferencias.

El buscador pagina por `(captured_at DESC, id DESC)`, limita cada RPC a 1–100 resultados y filtra en PostgreSQL por contador, código, serie, partida, ubicación y fecha. La pantalla ofrece 50 por página con cursor opaco. Los índices de Fase 5 corresponden a esos predicados y ordenación. La actualización es manual y cada 60 segundos mientras el panel está visible; ese polling consulta el servidor, no registra heartbeats ni declara presencia.

`sync_devices.last_seen_at` y `last_sync_at` son observaciones globales históricas y no se usan para decidir el estado del panel. `app_private.inventory_device_activity` conserva la evidencia mínima por `(inventory_id, device_id, user_id)` y es actualizada solamente por inserciones aceptadas de `sync_counts` y por `report_device_sync_state`. La UI sólo etiqueta `ACTIVO RECIENTEMENTE`, `SIN ACTIVIDAD RECIENTE` o `SIN DATOS`; nunca “online”. “Pendientes conocidos” es inventory-scoped y no representa dispositivos completamente offline. Series repetidas de ítems SERIAL aparecen como alerta no bloqueante; PARTIDA no usa esa alerta.

Los campos HTML `type=date` se interpretan como días locales del operador. El cliente convierte inicio local inclusivo e inicio local del día siguiente exclusivo a `timestamptz` absolutos antes del RPC; PostgreSQL sólo compara instantes y no asume una zona horaria humana.
## Sincronización de outbox — Fase 4

`CaptureRuntime` y `SyncCoordinator` son composiciones separadas. La primera exige contexto autorizado `ABIERTO`; la segunda se inicia con sesión válida, descubre scopes persistentes por usuario y usa un worker single-flight por inventario. Por ello el cierre del inventario bloquea captura, no la reconciliación de registros ya guardados. Los puertos locales contienen operaciones semánticas de outbox, no detalles SQL/Dexie; el gateway traduce Supabase a errores de dominio tipados y seguros.

## Correcciones y cortes — Fase 6

La corrección pre-corte y el corte son mutaciones canónicas PostgreSQL, no secuencias de escrituras desde React. Ambas toman `app_private.lock_inventory`; la corrección también bloquea la fila de conteo. Así se serializa con `sync_counts`: un registro aceptado antes de la selección entra una vez al snapshot y uno recibido después queda disponible para el siguiente corte.

`create_cut` resuelve `request_id` bajo el bloqueo, asigna secuencias mediante una operación set-based ordenada por `(received_at ASC, id ASC)` e inserta snapshots inmutables en la misma transacción. La interfaz llama sólo read models y RPC protegidas. La pantalla CORTES no ofrece acción a CONTADOR, deshabilita el doble clic y explica explícitamente que no hay XLSX ni stock ERP. La corrección carga un contexto autorizado, solicita motivo y muestra las revisiones; no ofrece rectificación post-corte.
