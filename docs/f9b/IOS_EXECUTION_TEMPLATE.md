# Plantilla de ejecución iOS física

Estado inicial: `NOT_RUN`. Si no hay hardware iOS físico disponible, registrar `BLOCKED`; Simulator no satisface este gate.

## Identificación obligatoria

| Campo | Valor de ejecución |
|---|---|
| execution_id | |
| gate | `IOS_PHYSICAL` |
| status | `NOT_RUN` |
| candidate_sha / build_sha | |
| app_version | |
| started_at / finished_at UTC | |
| operator / environment | |
| device_category / device_model | |
| os / os_version | |
| evidence_refs / defects / notes | |

## Matriz física

| Categoría | Modelo / SO | Estado inicial | Evidencia |
|---|---|---|---|
| iPhone compacto | | `NOT_RUN` | |
| iPhone estándar | | `NOT_RUN` | |
| iPhone grande | | `NOT_RUN` | |
| iPad | | `NOT_RUN` | |

## Device Health — LIGHT y FULL

Ejecutar ambos modos y registrar evidencia real para `APP_VERSION`, `AUTH_USER`, `INVENTORY_CONTEXT`, `MASTER_SNAPSHOT`, `LOCAL_DATABASE`, `LOCAL_STORAGE`, `BACKEND_CONNECTIVITY`, `DEVICE_TIME`, `CAMERA_AVAILABLE`, `CAMERA_PERMISSION` y `SCANNER_AVAILABLE`.

## Persistencia, capacidad y scanner

Con inventario y usuario de prueba: guardar offline, confirmar `PENDING`, cerrar/reabrir, reiniciar el dispositivo, verificar persistencia, reconectar y sincronizar el mismo `client_count_id` sin pérdida. Comprobar umbrales 39 normal, 40 warning, 45 critical y 50 bloqueo sin eliminar pendientes.

Probar QR, Code128 y GS1-128/EAN-128 cuando exista muestra, cancelación y retorno al formulario sin auto-guardado. Registrar restauración del scanner en `READY`, en `BLOCKED`, y `BLOCKED → READY` exactamente una vez.

## UI y rendimiento

Validar safe areas, notch/Dynamic Island, barra gestual, teclado, orientación soportada, touch targets, fuentes grandes, textos largos y cero overflow horizontal. Medir SQLite <300 ms, lookup SKU <300 ms, apertura <1 s y sync sin bloquear captura; si no existe método fiable registrar `MEASUREMENT_METHOD_REQUIRED`, sin telemetría productiva.
