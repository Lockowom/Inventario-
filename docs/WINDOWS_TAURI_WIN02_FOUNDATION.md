# WIN-02 · Foundation Tauri 2 para INVEN3 Windows QA

Base: `f0474474a3459087c43bedbd750d55c87211d7fa` en
`feature/f16-live-monitor-consolidated`.

## Alcance y límites

WIN-02 añade una ventana Windows QA para el mismo frontend React/Vite. No
modifica dominio, reglas C1/C2/C3, conciliación, Supabase remoto, migraciones,
Edge Functions, Android, iOS ni producción.

Tampoco certifica SQLite Windows, offline/reinicio Windows, scanner USB o
webcam, filesystem nativo, updater, firma o instalador. Ninguna de esas
capacidades se anuncia como disponible.

## Toolchain detectado

| Componente | Resultado |
| --- | --- |
| Windows / proceso | x64 / x64 |
| Node / npm | 24.12.0 / 11.6.2 |
| Rust / Cargo | 1.95.0 / 1.95.0 |
| MSVC | Visual Studio Build Tools 2022 17.14.31, C++ x64 presente |
| WebView2 Runtime | 154.0.4258.62 |
| Git de entrada | limpio en `f0474474a3459087c43bedbd750d55c87211d7fa` |

`cl.exe` no estaba en el `PATH` ordinario, pero Cargo compiló y enlazó con las
Build Tools detectadas, por lo que la toolchain nativa quedó validada.

## Dependencias y estructura

- `@tauri-apps/api` 2.12.2: detección de runtime dentro de `src/platform`.
- `@tauri-apps/cli` 2.12.1: comandos `npm run tauri:dev` y
  `npm run tauri:build`.
- `src-tauri/`: manifiesto Cargo, `build.rs`, `src/main.rs`, capability mínima,
  configuración Tauri, lockfile e ícono Windows.

`tauri.conf.json` usa Vite existente: en desarrollo abre
`http://127.0.0.1:5173`; en build consume `../dist`. El bundle de instalador
permanece desactivado: el único artefacto de esta fase es el ejecutable QA
foundation, sin firma ni publicación.

La CSP permite assets propios, el servidor local de desarrollo y conexiones
cifradas (`https:` / `wss:`) elegidas por el entorno Vite; no codifica host ni
clave de Supabase. La política de release y Vite restringen el backend de QA a
INVEN3-QA antes de construir. No se habilitaron shell, filesystem, comandos,
HTTP inseguro ni permisos adicionales: `capabilities/default.json` concede
sólo `core:default`.

## Runtime Windows

`WindowsPlatformAdapter` se selecciona antes del fallback Capacitor cuando
`isTauri()` confirma el runtime. No usa user-agent. Declara:

| Capacidad | Estado WIN-02 |
| --- | --- |
| Runtime Windows | disponible |
| Repositorios de UI | fallback IndexedDB temporal |
| Storage durable para inventario | pendiente WIN-06 |
| Scanner/webcam/USB | no disponible; no bloquea diagnóstico Android-only |
| Updater Windows | no disponible; no ejecuta Capgo |
| Lifecycle | versión Vite mínima |

La pantalla de infraestructura y Componentes muestran `PENDIENTE WIN-06` /
`SQLite Windows pendiente WIN-06`, evitando afirmar que el fallback temporal
sea offline durable certificado.

## Pruebas y evidencia

Ejecutado localmente:

- `cargo check --manifest-path src-tauri/Cargo.toml` — PASS.
- `npm run tauri:build` — PASS.
- `npm run tauri:dev` — inicia y deja Vite escuchando en `127.0.0.1:5173`.
- Ejecutable Windows iniciado y permaneció activo tras cinco segundos.
- Frontera + Android/offline/scanner/OTA: 11 archivos, 59 pruebas — PASS.

El login QA, restauración de sesión, roles y navegación deben introducirse y
validarse manualmente por una persona autorizada; WIN-02 no automatiza ni lee
credenciales. La aplicación queda abierta con `npm run tauri:dev` para esa
prueba manual.

## WIN-02.1 · Ejecución QA explícita

Windows conserva el modo técnico Tauri/Vite de desarrollo, pero ahora inicia
Vite con el modo `qa`: `npm run tauri:dev:qa` (el alias existente
`npm run tauri:dev` usa el mismo comando QA porque esta fundación es sólo QA).
El build Windows usa también `npm run build:qa` antes de compilar Rust.

Vite carga sus variables ya existentes desde `.env.local` o, con mayor
prioridad para este caso, `.env.qa.local`. El segundo archivo queda ignorado;
`.env.qa.example` contiene únicamente los nombres de las variables públicas y
la identidad de release. No se añade ninguna variable nueva, secreto de
servidor, usuario ni valor de credencial al repositorio.

En QA/Beta el diagnóstico etiqueta el canal como `QA-BETA`; esta es sólo una
presentación de la pareja ya existente `VITE_RELEASE_ENV=qa` +
`VITE_RELEASE_CHANNEL=beta`.

## Artefacto QA foundation

| Campo | Valor |
| --- | --- |
| Ruta | `src-tauri/target/release/inven3-windows-qa.exe` |
| Tipo | ejecutable Windows QA, sin instalador ni firma |
| Versión | 1.0.0 |
| Tamaño | 10,402,816 bytes |
| SHA-256 | `358B718B1DA3E85FB74AC1183EC3EEB74CA75375C7987B83DF5A7EEEE49D613E` |

## Riesgos y siguiente fase

El fallback IndexedDB no puede certificar sobreviencia a reinicio ni reemplaza
el outbox Windows. No se debe certificar captura offline Windows hasta WIN-06.
WIN-03 puede limitarse a cierre manual de UI runtime: matriz 1366×768 y
1920×1080, escalas 100/125/150 %, overflow, header/drawer/tablas/modales y
navegación autorizada por rol. No debe introducir scanner, SQLite, updater,
filesystem ni cambios de backend.
