# CUT2-03 — certificación local final (parcial y bloqueada)

Fecha: 2026-10-13  
Rama: `feature/f16-live-monitor-consolidated`  
Base CUT2-03: `93d995b40a98cfc8a3283887e689f0c6edbc7e75`  
Implementación inicial revisada: `7176b528b8c13770b632596040d969c67e349ef3`

## Corrección encontrada en certificación

Se detectó que la excepción que permite un C2 originado por rolling cut durante
C1 global abierto anulaba accidentalmente el filtro F16 contra autoreclamo. La
migración `20261013170000_cut2_03d_c2_role_separation_hardening.sql` restaura la
exclusión para el contador que generó la evidencia C1 y conserva el acceso para
otro CONTADOR autorizado. No modifica contratos de C1, snapshots, sellos,
conciliación, RP ni XLSX.

La prueba focal `cut2_03_rolling_cut_test.sql` ahora usa dos contadores y
certifica: el origen C1 observa cero C2 disponibles; el segundo contador observa
y reclama exactamente la misión C2 ciega mientras C1 global permanece abierto.

## Ejecuciones verificadas

| Control | Resultado |
| --- | --- |
| `supabase db reset --local --no-seed --yes` | PASS |
| `supabase test db --local supabase/tests/cut2_03_rolling_cut_test.sql` | PASS, 1 archivo / 22 pruebas |
| `supabase test db --local supabase/tests` | PASS, 34 archivos / 561 pruebas |
| `npm run typecheck` | PASS |
| `npm run lint` | PASS |
| `npm test` | PASS, 79 archivos / 450 pruebas |
| `npm run build` | PASS (advertencia informativa de tamaño de chunks) |
| `supabase db advisors --local --type security --level warn --fail-on error` | PASS, sin hallazgos |

`supabase db lint --local` no informa errores CUT2-03. Conserva tres advertencias
preexistentes y ajenas al corte: inmutabilidad de
`app_private.canonical_rectification_payload`, variable no usada en
`request_cut_file_generation` y variable no usada en `get_inventory_lifecycle`.

## Cobertura certificada por pruebas locales existentes

- corte rodante, sello, snapshot y audit event único;
- diferencia que crea un único caso y C2; coincidencia sin C2;
- referencias no seleccionadas que continúan OPEN_C1;
- C1 global abierto;
- `PREVIEW_STALE`, retry idempotente e `IDEMPOTENCY_CONFLICT`;
- rechazo de conteo tardío con `REFERENCE_SEALED`;
- ausencia de release RP y XLSX;
- CONTADOR sin facultad para crear el corte;
- aislamiento operativo C1/C2 del mismo usuario y reclamo por contador distinto;
- regresión completa de la suite heredada, incluido contrato `LEGACY_SNAPSHOT`.

## Concurrencia con conexiones PostgreSQL independientes

La dirección **SEAL gana** de COUNT-vs-SEAL fue ejecutada contra PostgreSQL local
en dos conexiones independientes. La sesión ADMIN mantuvo abierta la transacción
del rolling cut y la sesión CONTADOR intentó `sync_counts` sobre la misma
referencia. Tras el commit del seal, el conteo devolvió
`REJECTED:REFERENCE_SEALED`.

Evidencia final: cut `573d8672-f9e6-4af2-b0d3-325328c432b4`, `sealed=1`,
`snapshots=1`, `late_count=0`, `audit=2` (un evento de referencia y uno de
corte). No se insertó el conteo tardío ni se alteró el snapshot.

## Fingerprint del preview ejecutado

Fixture local `CUT03-FP`: el CONTADOR registró un C1 aceptado para `SKU-FP` con
cantidad 5. Un intento de corte con fingerprint anterior respondió
`PREVIEW_STALE` y fue revertido. Con el preview recalculado, el rolling cut
`49f22a53-e667-423d-9c4b-f520e0b7d3c6` confirmó con `snapshot_count=1`,
`c2_count=0`; la evidencia del snapshot suma `qty=5`. Así se confirma que el
conteo previo entra en el snapshot solamente después de la revalidación actual.

## Pendiente obligatorio para cerrar el gate

Esta ejecución no realizó el conjunto completo de experimentos de dos conexiones
PostgreSQL: falta COUNT-gana, SEAL-vs-SEAL y selecciones solapadas. COUNT-gana
debe revalidar con fingerprint nuevo después del commit del conteo; reutilizar
el anterior debe responder `PREVIEW_STALE` y no se considera evidencia válida.
Tampoco
añadió las fixtures de certificación independientes requeridas para PARTIDA
match/mismatch/multi-ubicación, SERIAL match/mismatch/duplicado, UOM, huérfano,
Disponible negativo, finding crítico y dos bodegas. Tampoco existe una medición
`EXPLAIN ANALYZE` representativa de revalidación, materialización y generación de
C2 sobre dataset de volumen.

Por integridad de certificación, esos casos no se marcan como PASS. No se hizo
push, deploy, cambio remoto, QA remoto, producción, iOS, Windows/Tauri ni
CUT2-04.

## Gate

`BLOCKED_FOR_CUT2_ROLLING_CUT_LOCAL` hasta completar las pruebas anteriores con
evidencia reproducible y revisión de rendimiento local.

## Hallazgo reproducible CUT2-03J — guards pre-seal no representables

La inspección directa de la base local demuestra un defecto de modelo que bloquea
la certificación de `UOM_MISMATCH` y `CRITICAL_FINDING_OPEN` antes de sellar:

- `public.count_records` no tiene columna de UOM; por lo tanto un conteo físico
  normal no puede expresar `UN` frente a `CJ`.
- `public.uom_resolution_cases.reference_id` y
  `public.reference_findings.reference_id` apuntan a una
  `inventory_sealed_references` ya existente.
- El preview CUT2-02 consulta ambos guards mediante joins con referencias ya
  selladas. Para una identidad candidata nueva, no existe una fila a la que
  anclar el caso o finding antes de `create_rolling_cut_v2`.

En consecuencia, no se puede construir por el flujo real una fixture que haga
que una identidad OPEN_C1 sea bloqueada por UOM o finding crítico sin insertar
un estado artificial posterior al seal. Eso contradice el requisito de bloquear
el rolling cut previo. El gate permanece bloqueado hasta introducir un modelo
pre-seal explícito (fuera del alcance autorizado de esta certificación).

## Recuperación local CUT2-03H

El bloqueo del 2026-10-14 fue de disponibilidad local, no funcional: el contexto
`desktop-linux` era correcto y `DOCKER_HOST` estaba vacío, pero la distribución
WSL `docker-desktop` estaba detenida y el named pipe
`dockerDesktopLinuxEngine` no existía. No se ejecutó `wsl --shutdown`, ni se
reinició Windows, servicios o contenedores manualmente. Se inició Docker Desktop
por su AppID registrado y se esperó al backend.

Resultado: Docker Client/Server `29.8.1`, `docker-desktop` en ejecución,
`supabase_db_inven3` healthy. Posteriormente `supabase db reset --local
--no-seed --yes` y la suite completa pgTAP terminaron PASS: 34 archivos / 561
pruebas. La recuperación no modifica el estado del gate: las matrices de
concurrencia, identidades y rendimiento siguen pendientes de evidencia.

## CUT2-03L — evidencia de certificación previa al gate final

Fecha: 2026-10-14
Checkpoint de entrada: `aa73351e6ebf367edc1aca9f700ace8797cec794`

Esta ejecución sustituyó las matrices que antes figuraban como pendientes por
pruebas reproducibles locales. No hubo acceso a QA remoto, producción, iOS,
Windows/Tauri, OTA, despliegues ni push.

El reset final reconstruyó las migraciones locales, pero dejó servicios
auxiliares de Supabase inestables y el runner pgTAP dejó de responder. Por
integridad, esta evidencia no sustituye la repetición de la suite global en un
entorno local saludable y no habilita aún el gate final.

| Control | Resultado | Evidencia |
| --- | --- | --- |
| UOM MATCH / MISMATCH / MISSING / CONFLICT | PASS | `cut2_03k_preseal_guards_test.sql` (18) |
| Finding crítico / resolución / aislamiento / vínculo | PASS | `cut2_03k_preseal_guards_test.sql` (18) |
| Count-before-preview / stale fingerprint / seal-wins | PASS | `cut2_03_rolling_cut_test.sql` (22) y carrera local |
| Seal vs seal | PASS | dos sesiones PostgreSQL; 1 sello, 1 `PREVIEW_STALE`, 1 snapshot, 0 `SEALING` |
| Selecciones X+Y vs Y+Z | PASS | dos sesiones PostgreSQL; X=1, Y=1, Z=0, 2 snapshots, 0 `SEALING` |
| Partida match / mismatch / multi-ubicación | PASS | `cut2_03l_identity_matrix_test.sql` (31) |
| Serial match / mismatch / duplicado | PASS | `cut2_03l_identity_matrix_test.sql` (31) |
| Orphan / saldo negativo / multi-bodega | PASS | `cut2_03l_identity_matrix_test.sql` (31) |
| C1 continúa / separación de originador / C2 ciego | PASS | `cut2_03_rolling_cut_test.sql` (22) |
| Offline, outbox y clientes antiguos | PASS | contrato aditivo de `sync_counts` y regresiones CUT2-03K/CUT2-03 |
| Legacy snapshot y artefactos RP | PASS | suite heredada CUT2 |

### Carreras ejecutadas

**Seal vs seal.** Dos conexiones independientes intentaron sellar
`CUT-CONC-SS-01` con el mismo fingerprint. La primera creó el cut
`e4fd7ba7-c6b2-4613-9a07-5ce68c1de89b`; la segunda recibió
`PREVIEW_STALE`. Estado final: `sealed=1`, `snapshots=1`, `C2=0`,
`CUT_EVENTS=2`, `SEALING=0`.

**Selección solapada.** Dos conexiones intentaron `X+Y` y `Y+Z`. Ganó X+Y con
cut `1a386506-c10e-4918-a0fc-f3407f6e147b`; la segunda recibió
`PREVIEW_STALE`. Estado final: X=1, Y=1, Z=0, snapshots=2, C2=0 y
`SEALING=0`. No existe éxito parcial de Z.

### Rendimiento local sintético

El dataset se generó dentro de transacciones que terminaron en `ROLLBACK`:
10.000 identidades sintéticas, mezcla LEGACY/PARTIDA/SERIAL, multi-ubicación,
UOM explícita y referencias selladas/casos de control. No se conservaron datos
de prueba.

| Camino `EXPLAIN (ANALYZE, BUFFERS)` | Planning | Execution | Rows/loops | Scan / índice | Buffers | Observación |
| --- | ---: | ---: | --- | --- | ---: | --- |
| Preview/revalidación | 0.043 ms | 1333.187 ms | 1 / 1 | Result (función completa) | 15687 hit | Recorre las 10k identidades para reconstruir el fingerprint; sin N+1. |
| Lookup canónico | 0.160 ms | 0.065 ms | 1 / 1 | `inventory_system_reference_items_live_lookup_idx` | 3 hit | Lookup puntual indexado. |
| UOM pre-seal | 0.212 ms | 20.278 ms | 0 / 1 | GroupAggregate + seq scan 10k | 264 hit | Agregación completa intencional, sin loop explosivo. |
| Finding pre-seal | 0.233 ms | 0.044 ms | 0 / 1 | Seq scan tabla mínima | 1 hit | No había findings sintéticos abiertos en esta corrida. |
| Conflicto sellado | 0.217 ms | 0.077 ms | 0 / 1 | Seq scan tabla mínima | 1 hit | La ruta real está además cubierta por las carreras. |
| Materialización de snapshot | 1.335 ms | 115.326 ms | 1 / 1 | Hash join + dos seq scans 10k | 423 hit | Selección por clave canónica calculada; coste lineal controlado. |
| C2 lookup/generación | 0.808 ms | 0.062 ms | 1 / 1 | Nested loop | 2 hit | Caso/misión sintéticos encontrados una vez. |
| `sync_counts` guard sellado | 0.055 ms | 7.297 ms | 1 / 1 | Function scan | 569 hit | Rechazo contra una referencia sellada, sin inserción C1. |

No se añadió índice ni migración por estas mediciones: no apareció N+1,
deadlock, lectura repetitiva ni coste que justifique cambiar el plan de datos.

### Cambios de certificación

- Se añadió `supabase/tests/cut2_03l_identity_matrix_test.sql` con 31
  aserciones conductuales para partidas, series, huérfanos, saldo negativo y
  aislamiento de bodega.
- No se crearon migraciones de esquema.
- Las advertencias históricas del linter/advisor se documentan separadamente;
  no hay hallazgos de seguridad nuevos de CUT2-03K.

## CUT2-03M — certificación post-reset

Fecha: 2026-10-15
Checkpoint de entrada: `eb5fca286f371c55ee09a0138c2a7eaed8c31e5c`

Esta repetición recuperó Docker Desktop sin reiniciar Windows ni modificar
contenedores manualmente y reconstruyó la base local con
`supabase db reset --local --no-seed --yes`. La suite de base de datos se
ejecutó inmediatamente después del reset y concluyó PASS: 36 archivos / 610
aserciones, incluyendo explícitamente `cut2_03l_identity_matrix_test.sql`
(31/31).

La ejecución reveló además tres pruebas de cliente desactualizadas respecto de
la migración SQLite v8 de CUT2-03K. La corrección fue exclusivamente de los
fixtures/expectativas de prueba: se preservó `physical_uom` en el fake SQLite y
se actualizó la versión esperada de v7 a v8. No cambió SQL remoto, migraciones,
reglas C1/C2/C3, contratos Supabase ni comportamiento visible.

| Control | Resultado | Evidencia |
| --- | --- | --- |
| Reset local sin seed | PASS | migraciones locales aplicadas hasta `20261014163539` |
| pgTAP completo post-reset | PASS | 36 archivos / 610 aserciones |
| Matriz CUT2-03L | PASS | 31/31 aserciones |
| Regresión dirigida SQLite v8 | PASS | 3 archivos / 28 pruebas |
| `npm test` | PASS | 79 archivos / 450 pruebas |
| `npm run typecheck` | PASS | sin diagnósticos |
| `npm run lint` | PASS | sin warnings ni errores |
| `npm run build` | PASS | 298 módulos; sólo avisos informativos de Rollup en dependencias |
| `supabase db lint --local --level warning --fail-on error` | BLOCKED | PostgreSQL local dejó de aceptar conexiones en `127.0.0.1:54322` después de los gates anteriores |

### Bloqueo residual de entorno

Al intentar el último lint local, el motor Docker pasó de disponible a rechazar
el named pipe `dockerDesktopLinuxEngine` por permisos y PostgreSQL local dejó
de escuchar en el puerto `54322`. Se intentó iniciar Docker Desktop mediante su
AppID existente, sin detener/recrear contenedores, pero el pipe siguió
inaccesible desde esta sesión. El problema es de disponibilidad/permisos del
entorno local; no es un error de migración ni un hallazgo de seguridad.

Por integridad, no se declara el gate final como READY mientras no se repita
ese lint en una pila local accesible. No hubo push, deploy, cambio remoto,
acceso a QA remoto, producción, iOS, Windows/Tauri ni CUT2-04.

## Gate CUT2-03M

`BLOCKED_FOR_CUT2_ROLLING_CUT_LOCAL` únicamente por el lint final de base
local no ejecutable debido al acceso perdido al motor Docker. Todos los demás
gates de datos y aplicación listados arriba están PASS.
