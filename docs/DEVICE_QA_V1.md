# QA físico de dispositivos — Fase 9

Estado de certificación: `ANDROID_PHYSICAL = PASS`; `IOS_PHYSICAL = DEFERRED_NON_BLOCKING`. Android fue ejecutado sobre Xiaomi 15T con offline/reboot/sync/scanner. iOS fue ejecutado sobre iPhone real BrowserStack hasta instalación, arranque, `Storage READY`, `Supabase CONFIGURED`, sesión autenticada y UI operacional; el ciclo offline físico exhaustivo quedó diferido por decisión de alcance del 2026-09-28 y no se declara PASS. La guía coordinada y las plantillas vacías están en [F9B_EXECUTION_PACK.md](F9B_EXECUTION_PACK.md) y [docs/f9b](f9b/README.md).

## Reglas de ejecución

- Usar sólo usuarios, inventarios y datos de prueba.
- Registrar modelo, versión SO, SHA candidato/build, app version, fecha UTC, responsable, estado, defectos y referencias de evidencia.
- Sin dispositivo físico, registrar `BLOCKED`; un emulador o Simulator nunca satisface este gate.
- Estados permitidos del registro: `NOT_RUN`, `PASS`, `FAIL`, `BLOCKED`. No declarar `PASS` con un defecto `BLOCKER` o `CRITICAL` abierto.

## Matriz Android

| Categoría | Estado inicial | Registro |
|---|---|---|
| Android angosto | `NOT_RUN` | [plantilla Android](f9b/ANDROID_EXECUTION_TEMPLATE.md) |
| Android estándar | `NOT_RUN` | [plantilla Android](f9b/ANDROID_EXECUTION_TEMPLATE.md) |
| Android grande | `NOT_RUN` | [plantilla Android](f9b/ANDROID_EXECUTION_TEMPLATE.md) |
| Android alta densidad | `NOT_RUN` | [plantilla Android](f9b/ANDROID_EXECUTION_TEMPLATE.md) |
| Tablet Android | `NOT_RUN` | [plantilla Android](f9b/ANDROID_EXECUTION_TEMPLATE.md) |

## Matriz iOS

| Categoría | Estado inicial | Registro |
|---|---|---|
| iPhone compacto | `NOT_RUN` | [plantilla iOS](f9b/IOS_EXECUTION_TEMPLATE.md) |
| iPhone estándar | `NOT_RUN` | [plantilla iOS](f9b/IOS_EXECUTION_TEMPLATE.md) |
| iPhone grande | `NOT_RUN` | [plantilla iOS](f9b/IOS_EXECUTION_TEMPLATE.md) |
| iPad | `NOT_RUN` | [plantilla iOS](f9b/IOS_EXECUTION_TEMPLATE.md) |

## Checklist común obligatorio

1. Ejecutar Device Health `LIGHT` y `FULL`: `APP_VERSION`, `AUTH_USER`, `INVENTORY_CONTEXT`, `MASTER_SNAPSHOT`, `LOCAL_DATABASE`, `LOCAL_STORAGE`, `BACKEND_CONNECTIVITY`, `DEVICE_TIME`, `CAMERA_AVAILABLE`, `CAMERA_PERMISSION` y `SCANNER_AVAILABLE`.
2. Offline/SQLite: guardar offline, ver `PENDING`, cerrar/reabrir, reiniciar dispositivo, confirmar persistencia, reconectar, sincronizar el mismo `client_count_id` y confirmar cero pérdida.
3. Capacidad offline: 39 normal, 40 warning, 45 critical, 50 bloquea nueva captura; nunca eliminar pendientes.
4. Scanner: QR, Code128 y GS1-128/EAN-128 cuando exista muestra; cancelar, volver al formulario y confirmar que no auto-guarda. Probar restauración `READY`, `BLOCKED` y `BLOCKED → READY` una sola vez.
5. UI: cero overflow horizontal, teclado no tapa `GUARDAR`, safe areas, barra gestual, notch/Dynamic Island cuando corresponda, orientación soportada, touch targets, fuentes grandes y textos largos.
6. Rendimiento: medir SQLite <300 ms, lookup SKU <300 ms, abrir formulario <1 s y sync sin bloquear captura con un método reproducible. Si falta, registrar `MEASUREMENT_METHOD_REQUIRED`; no agregar telemetría productiva.
