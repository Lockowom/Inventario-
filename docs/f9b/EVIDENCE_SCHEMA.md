# Schema de evidencia F9B

Un registro representa una ejecución humana o externa. Los valores deben provenir de la ejecución real; los ejemplos de forma se omiten deliberadamente para no crear evidencia ficticia.

## Registro de ejecución

| Campo | Requerido | Descripción |
|---|---|---|
| `execution_id` | sí | identificador único de la ejecución |
| `gate` | sí | `ANDROID_PHYSICAL`, `IOS_PHYSICAL`, `RP_REAL_IMPORT` o `BETA_MANUAL` |
| `status` | sí | `NOT_RUN`, `PASS`, `FAIL` o `BLOCKED` |
| `candidate_sha` | sí | SHA del candidato evaluado |
| `build_sha` | sí | SHA incorporado en el build probado |
| `app_version` | sí | versión de la app instalada/probada |
| `started_at` / `finished_at` | sí | timestamps UTC explícitos de inicio y fin |
| `operator` | sí | persona responsable de la ejecución |
| `environment` | sí | ambiente controlado usado |
| `evidence_refs` | sí | array de enlaces o identificadores de evidencia; obligatorio y no vacío para `PASS` |
| `defects` | sí | array de defectos, incluso vacío |
| `notes` | sí | observaciones operacionales |

Para `ANDROID_PHYSICAL` e `IOS_PHYSICAL` también son obligatorios `device_category`, `device_model`, `os` y `os_version`.

Para `RP_REAL_IMPORT` también son obligatorios `file_name`, `sha256`, `record_count`, `rp_environment`, `rows_accepted` y `rows_rejected`.

Para `BETA_MANUAL` también son obligatorios `role`, `scenario` y `observer`.

## Schema de defecto

Cada elemento de `defects` registra:

| Campo | Descripción |
|---|---|
| `defect_id` | identificador único |
| `gate` | gate donde se observó |
| `scenario` | escenario afectado |
| `severity` | `BLOCKER`, `CRITICAL`, `MAJOR` o `MINOR` |
| `description` | descripción del defecto |
| `expected` | comportamiento esperado |
| `observed` | comportamiento observado |
| `evidence` | referencia de evidencia del defecto |
| `build_sha` | SHA del build afectado |
| `status` | estado del defecto; un estado `OPEN` permanece abierto |
| `rerun` | referencia al rerun o indicación explícita de que no aplica |

Un registro `PASS` es inválido si tiene un defecto `BLOCKER` o `CRITICAL` cuyo `status` sea `OPEN` (sin importar mayúsculas/minúsculas). Un fallo de integridad beta —pérdida de conteos, duplicados técnicos, corrupción de outbox o cortes superpuestos— debe registrarse como `FAIL` con severidad `BLOCKER`.

## Alcance del validador

El validador local comprueba campos obligatorios, estados permitidos, referencias de evidencia de `PASS`, defectos abiertos críticos, identidad física y SHA-256 de RP. No valida la veracidad de los enlaces, no ejecuta gates y no cambia estados en `CERTIFICATION_V1.md`.
