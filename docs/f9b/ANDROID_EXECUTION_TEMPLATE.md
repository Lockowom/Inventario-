# Plantilla de ejecución Android física

Estado inicial: `NOT_RUN`. Si no hay dispositivo físico disponible, registrar `BLOCKED`; un emulador no sustituye este gate.

## Identificación obligatoria

| Campo | Valor de ejecución |
|---|---|
| execution_id | |
| gate | `ANDROID_PHYSICAL` |
| status | `NOT_RUN` |
| candidate_sha / build_sha | |
| app_version | |
| started_at / finished_at UTC | |
| operator / environment | |
| device_category / device_model | |
| os / os_version | |
| evidence_refs / defects / notes | |

## Matriz física

Ejecutar una fila por dispositivo disponible. No inferir resultados entre categorías.

| Categoría | Modelo / SO | Estado inicial | Evidencia |
|---|---|---|---|
| Android angosto | | `NOT_RUN` | |
| Android estándar | | `NOT_RUN` | |
| Android grande | | `NOT_RUN` | |
| Android alta densidad | | `NOT_RUN` | |
| Tablet Android | | `NOT_RUN` | |

## Device Health — LIGHT y FULL

Para cada modo ejecutar y registrar estado observado, timestamp y evidencia, sin copiar resultados de CI:

- `APP_VERSION`, `AUTH_USER`, `INVENTORY_CONTEXT`, `MASTER_SNAPSHOT`.
- `LOCAL_DATABASE`, `LOCAL_STORAGE`, `BACKEND_CONNECTIVITY`, `DEVICE_TIME`.
- `CAMERA_AVAILABLE`, `CAMERA_PERMISSION`, `SCANNER_AVAILABLE`.

## Persistencia SQLite y offline

1. Usar exclusivamente usuario e inventario de prueba; desconectar la red.
2. Guardar un conteo offline y confirmar `PENDING`.
3. Cerrar y reabrir la app; confirmar el mismo `client_count_id`.
4. Reiniciar físicamente el dispositivo, abrir la app y confirmar persistencia sin pérdida.
5. Reconectar, sincronizar y confirmar que el mismo `client_count_id` llega una vez.

Registrar UUID, evidencia y cualquier pérdida como `BLOCKER`. Nunca eliminar pendientes para completar el paso.

## Capacidad offline

En ejecuciones independientes comprobar 39, 40, 45 y 50 pendientes: 39 normal; 40 warning; 45 critical; 50 bloquea nueva captura. Confirmar que no se eliminan pendientes en ningún umbral.

## Scanner físico

Probar QR, Code128 y GS1-128/EAN-128 cuando exista muestra. Probar cancelar y volver al formulario; el scanner nunca auto-guarda. Comprobar restauración con Health `READY`, con `BLOCKED`, transición `BLOCKED → READY` y aplicación exactamente una vez.

## UI y rendimiento

Comprobar sin overflow horizontal, teclado sin ocultar `GUARDAR`, safe areas, barra gestual, orientación soportada, touch targets, fuentes grandes y textos largos.

Medir, con cronómetro/profiling reproducible y evidencia: guardar SQLite normalmente menor a 300 ms, lookup SKU menor a 300 ms, abrir formulario menor a 1 s y sync sin bloquear captura. Si no hay método fiable, registrar `MEASUREMENT_METHOD_REQUIRED`; no agregar telemetría productiva.
