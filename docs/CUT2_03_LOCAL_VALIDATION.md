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
