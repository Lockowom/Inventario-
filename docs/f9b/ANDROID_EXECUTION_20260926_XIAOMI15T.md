# Ejecución Android física — Xiaomi 15T — 2026-09-26

## Identificación

| Campo | Valor |
|---|---|
| execution_id | `ANDROID-XIAOMI15T-20260926-01` |
| gate | `ANDROID_PHYSICAL` |
| status | `IN_PROGRESS` |
| candidate_sha / build_sha | `1328bc28a990136517c1d6d39555e4b44530ccab` |
| app_version | `f9b-qa-1328bc28` |
| observed_at | `2026-09-26T16:39:12Z` |
| environment | `INVEN3-QA` (`uazunvlxlszdyweddxtb`) |
| device_model | Xiaomi 15T |
| evidence | screenshots físicas aportadas durante ejecución F9B |
| notes | Primera ejecución real donde Device Health LIGHT alcanza `READY_WITH_WARNINGS`. Gate global aún no cerrado. |

## Device Health LIGHT

Resultado observado: `READY_WITH_WARNINGS` / “DISPOSITIVO LISTO CON ADVERTENCIAS”.

| Check | Resultado observado |
|---|---|
| APP_VERSION | PASS |
| AUTH_USER | PASS |
| INVENTORY_CONTEXT | PASS |
| MASTER_SNAPSHOT | PASS |
| LOCAL_DATABASE | PASS |
| LOCAL_STORAGE | WARN — espacio libre no observable |
| BACKEND_CONNECTIVITY | PASS |
| DEVICE_TIME | PASS |
| CAMERA_AVAILABLE | PASS |
| CAMERA_PERMISSION | UNAVAILABLE — Google scanner no requiere permiso de cámara de INVEN3 |
| SCANNER_AVAILABLE | PASS |

La captura física demuestra además que el runtime ya no cae en el error genérico de Device Health y que el maestro remoto se hidrata correctamente a SQLite local.

## Defectos resueltos durante esta ejecución

- Carrera de apertura SQLite.
- Carrera de migraciones SQLite.
- Transacciones anidadas por uso incorrecto de `execute('BEGIN IMMEDIATE')`.
- Hidratación automática del maestro QA a SQLite.
- Normalización UTC de timestamps PostgreSQL del maestro.
- Overflow móvil de controles de Supervisión.
- Etiqueta diagnóstica ambigua “Entorno: Production”.
- Insets Android 15/16 para mantener el WebView fuera de las barras del sistema.

## Hallazgo offline/sync en hardware

Durante el conteo físico real se generaron dos registros sintéticos `A-01-03 / 001234 / 1` en el Xiaomi. El servidor recibió ambos exactamente una vez, pero el cliente mostró uno como `SYNC_RESPONSE_INCOMPATIBLE` y otro como `PENDING`.

La verificación directa en `INVEN3-QA` confirmó:

- ambos `client_count_id` fueron insertados una sola vez en `count_records`;
- mismo usuario QA ANALISTA y mismo dispositivo físico;
- no hubo pérdida ni duplicación remota;
- el defecto estaba en el parser cliente de `received_at timestamptz`.

Se preparó forward-fix cliente para normalizar timestamps PostgreSQL de ACK a UTC y migración SQLite v6 que reencola exclusivamente falsos `SYNC_RESPONSE_INCOMPATIBLE`. El replay conserva `client_count_id` y depende de la idempotencia remota para resolver como `ALREADY_ACCEPTED`.

## Pendientes de esta ejecución

- Device Health `FULL`.
- Persistencia offline: PENDING → cerrar/reabrir → reinicio físico → reconectar → mismo `client_count_id` una sola vez.
- Capacidad offline: 39 / 40 / 45 / 50.
- Scanner físico: QR, Code128 y GS1-128/EAN-128 cuando exista muestra; cancelación sin autosave.
- UI restante: teclado, barra gestual, orientación, fuentes grandes/textos largos.
- Rendimiento físico reproducible.
- Determinar cobertura de categoría (estándar/grande/alta densidad) sin inferir resultados hacia otras categorías.
- Android angosto y tablet Android permanecen sin ejecución física.

No declarar `ANDROID_PHYSICAL = PASS` hasta cerrar el checklist obligatorio.
