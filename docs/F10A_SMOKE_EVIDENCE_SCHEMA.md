# F10A — Schema de evidencia de Beta Smoke

Este registro corresponde a una ejecución real de un **artefacto Release QA/BETA**. No se aceptan fixtures de desarrollo como evidencia.

## Campos obligatorios

| Campo | Regla |
|---|---|
| `execution_id` | Identificador único |
| `gate` | `F10A_BETA_SMOKE` |
| `status` | `NOT_RUN`, `PASS`, `FAIL` o `BLOCKED` |
| `platform` | `android` o `ios` |
| `candidate_sha` | SHA de 40 caracteres del candidato |
| `candidate_evidence_ref` | Ruta relativa normalizada al JSON exacto de candidate evidence; no acepta ruta absoluta, `..\/` ni backslashes |
| `candidate_evidence_sha256` | SHA-256 exacto del JSON de candidate evidence usado para ejecutar el smoke |
| `source_candidate_artifact_sha256` | SHA-256 presente en candidate evidence; debe resolver a APK en Android o IPA unsigned en iOS |
| `installed_artifact_sha256` | SHA-256 exacto del APK/IPA instalado y probado |
| `install_method` | `local_device` o `managed_device_lab` |
| `signing_provenance` | `candidate_as_built`, `ephemeral_lab_signing` o `laboratory_resign` |
| `version` | Debe ser `1.0.0` para F10A |
| `environment` | Debe ser `qa` |
| `channel` | Debe ser `beta` |
| `production_locked` | Debe ser `true` |
| `native_build_number` | Entero positivo |
| `app_display_version` | Versión observada en la app |
| `device_model` | Dispositivo físico/laboratorio real usado |
| `os` / `os_version` | Sistema operativo observado |
| `started_at` / `finished_at` | ISO-8601 |
| `operator` | Responsable de la ejecución |
| `checks` | Resultado de los checks mínimos |
| `evidence_refs` | Evidencia real; no vacío cuando status = PASS |
| `defects` | Array de defectos |
| `notes` | Observaciones |

## Checks mínimos

Todos deben ser `true` para un `PASS`:

- `app_launch`
- `release_identity_qa_beta`
- `supabase_configured`
- `authenticated_runtime`
- `health_non_blocking`
- `counting_screen`
- `my_counts_screen`
- `synthetic_count_saved`
- `synthetic_count_confirmed`
- `scanner_open_cancel_no_autosave`

El conteo debe usar exclusivamente inventario/usuario/datos sintéticos QA.

## Defectos

Cada defecto debe contener:

- `defect_id`
- `severity`: `BLOCKER`, `CRITICAL`, `MAJOR`, `MINOR`
- `scenario`
- `description`
- `expected`
- `observed`
- `status`
- `evidence`

Un `PASS` es inválido con defecto `BLOCKER` o `CRITICAL` abierto.

## Cierre F10A

El cierre exige simultáneamente:

1. candidate evidence Android = `READY_FOR_BETA_SMOKE`;
2. candidate evidence iOS = `READY_FOR_BETA_SMOKE`;
3. platform parity = `READY_FOR_BETA_SMOKE`;
4. Beta Smoke Android = `PASS`;
5. Beta Smoke iOS = `PASS`;
6. mismo commit, versión, QA/BETA y production lock;
7. la ruta `candidate_evidence_ref` coincide exactamente con el candidate evidence entregado al cierre;
8. el SHA-256 del candidate evidence registrado por el smoke coincide con ese JSON;
9. el hash fuente del smoke existe en candidate evidence;
10. la fuente Android es un APK y la fuente iOS es una IPA;
11. el hash instalado y la procedencia de firma son coherentes;
12. ningún defecto bloqueante abierto.

El JSON de cierre conserva además el SHA-256 de cada candidate evidence y del platform parity evidence, junto con la ruta y SHA-256 del artefacto fuente, el SHA-256 instalado, el método de instalación y la procedencia de firma para cada plataforma.

El cierre de F10A **no autoriza F10B, producción, TestFlight ni Google Play**.
