# WIN-00 · Auditoría de compatibilidad Windows

Base auditada: `53a9217600db126a45a9105acb958864f75ffc34`.

Esta auditoría no modifica Supabase, migraciones, Edge Functions, producción,
iOS ni los contratos de C1/C2/C3. El objetivo es dejar explícita la frontera
que permitirá añadir Tauri sin convertir Windows en un segundo producto.

## Clasificación de dependencias

| Grupo | Dependencias / superficie | Estado para Windows |
| --- | --- | --- |
| A · Core/web compartido | React, TypeScript, Vite, Zod, `@supabase/supabase-js`, Dexie, XLSX, fflate, dominio, SyncCoordinator, C1/C2/C3, conciliación y monitor | Se conserva. Supabase, RLS, RPC y Realtime no se duplican. Dexie es el fallback web y no es la base SQLite final de Windows. |
| B · Capacitor compartible por interfaz | `@capacitor/core`, `@capacitor/app`, `@capacitor-community/sqlite` | Encapsulados detrás de `PlatformAdapter`, `LifecycleAdapter` y `StorageAdapter`. Windows reemplazará sólo las implementaciones. |
| C · Android-only | `@capacitor/android`, `@capacitor-mlkit/barcode-scanning`, `@capgo/capacitor-updater`, proyecto `android/` | Continúan intactos. ML Kit y Capgo no se usan desde dominio ni features. |
| D · Reemplazo requerido en Windows | SQLite Tauri, updater Tauri, permisos/capabilities Tauri y, sólo si se requiere en WIN-13, diálogo/filesystem Tauri | Pendientes de WIN-02, WIN-06, WIN-13 y WIN-14. No se instalan ni se configuran en WIN-00/WIN-01. |

## Acoplamientos de plataforma encontrados

Antes de WIN-01, Capacitor aparecía directamente en composición de conteo,
scanner, diagnóstico, versión, OTA y la etiqueta enviada por Sync. Después de
WIN-01 los imports de `@capacitor/*` y `@capgo/*` quedan únicamente en:

- `src/platform/runtime-platform.ts`
- `src/platform/capacitor/capacitor-platform-adapter.ts`

El dominio no importaba Capacitor y continúa sin hacerlo. C1/C2/C3 mantienen
sus repositorios de dominio, el outbox, la idempotencia y `SyncCoordinator`.

## Resultado WIN-01

`src/platform/contracts.ts` define:

- `StorageAdapter`: repositorios de contexto, conteos, maestro y health local.
- `ScannerAdapter`: captura, health pasivo y recuperación de resultado nativo.
- `LifecycleAdapter`: versión de aplicación.
- `UpdateAdapter`: contrato nativo de verificación, descarga, aplicación y rollback.
- `PlatformCapabilities`: capacidades declarativas sin filtrar Capacitor a UI.
- `PlatformAdapter`: composición única por plataforma.

Las implementaciones son `WebPlatformAdapter` (con Dexie y actualización no
disponible) y `CapacitorPlatformAdapter` (con el comportamiento Android/iOS
preexistente). Tauri se registrará más adelante como un adaptador adicional;
no entra al dominio ni a las features.

No se crea `FileAdapter` todavía: las cargas actuales usan el estándar
`File`/`<input type=file>` del WebView y no solicitan filesystem nativo. WIN-13
deberá añadirlo sólo cuando se implementen seleccionar destino, abrir carpeta o
exportar nativamente, con permisos mínimos de Tauri.

## Riesgos y gates siguientes

1. El outbox de reconteos usa `localStorage`; se comporta en WebView, pero
   WIN-07 debe moverlo al storage durable del adaptador Windows antes de
   certificar offline/reinicio.
2. La migración de Dexie a SQLite Windows no puede borrar ni reusar a ciegas
   datos de otra plataforma. WIN-06 necesita un esquema propio versionado,
   transacciones y prueba de recuperación.
3. Scanner USB tipo teclado no requiere plugin Tauri para la primera entrega,
   pero WIN-08 debe detectar ráfaga/Enter sin romper digitación humana.
4. El updater Windows no puede reutilizar Capgo. WIN-14 requiere artefactos y
   manifiesto firmados, claves públicas empaquetadas y preservación explícita de
   SQLite durante actualización.
5. El uso actual de `navigator.onLine`, eventos `online` y controles `File`
   pertenece al estándar Web y funciona en un WebView; no se trata como API
   Android ni se mueve al dominio.

## Propuesta exacta para WIN-02

1. Instalar Tauri 2 y crear `src-tauri/` en la misma rama, sin mover React/Vite.
2. Configurar identificador QA, ventana, `devUrl` y `frontendDist` para el build
   existente; no añadir acceso filesystem amplio, SQLite, updater ni firmas.
3. Crear `WindowsPlatformAdapter` temporal que use el almacenamiento Web sólo
   para el smoke inicial de navegación/autenticación. Debe declarar que SQLite
   aún no está certificado.
4. Generar únicamente un ejecutable QA local/CI y verificar inicio, login QA,
   navegación y tamaños de ventana. No publicar, no conectar producción y no
   alterar Android/iOS.

WIN-02 puede comenzar sin riesgo arquitectónico: las dependencias nativas están
confinadas. Su gate es sólo abrir la UI compartida; offline, SQLite, scanner,
filesystem y actualización quedan deliberadamente fuera hasta sus fases.
