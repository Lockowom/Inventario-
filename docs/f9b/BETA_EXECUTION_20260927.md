# Beta interna F9B — ejecución consolidada 2026-09-27

Estado: `READY_FOR_MANUAL_SIGNOFF`.

Este registro consolida únicamente evidencia real ya obtenida en `INVEN3-QA`. No convierte automáticamente el gate manual en PASS.

## Identificación

| Campo | Valor |
|---|---|
| execution_id | `BETA-F9B-20260927-01` |
| candidate_sha / build_sha | `2aa6645ab89c5e74dc12c9475019880aca65564f` |
| app_version | `f9b-qa-2aa6645a` |
| environment | `INVEN3-QA` (`uazunvlxlszdyweddxtb`) |
| dataset | `INVEN3_QA_SYNTHETIC_F9B4_20260926T0535Z` |
| production data | `NO` |
| F10 | `NOT_STARTED` |

## Evidencia CONTADOR / captura

| Escenario | Estado | Evidencia |
|---|---|---|
| Login / identidad local | PASS | Login real y continuidad offline validados |
| Health LIGHT | PASS | Android físico |
| Health FULL | PASS_WITH_WARNINGS | Android físico; warnings no bloqueantes documentados |
| Maestro local | PASS | SERIAL/PARTIDA/LEGACY hidratados en SQLite |
| Conteo manual | PASS | Conteos físicos sintéticos creados |
| Scanner físico | PASS | Lectura óptica real en Xiaomi 15T |
| Offline | PASS | `READY_OFFLINE` |
| Cierre/reapertura | PASS | `PROCESS_RESTART_PERSISTENCE` |
| Reboot físico | PASS | `PHYSICAL_REBOOT_PERSISTENCE` |
| Reconnect / sync | PASS | `POST_REBOOT_SYNC` + cruce Supabase |
| Idempotencia | PASS | `client_count_id` sin duplicación remota |
| MIS CONTEOS | PASS | estados locales/confirmados observados |
| Capacidad 39/40/45/50 | PASS_AUTOMATED | runner `certify:f9b:auto-offline` |
| Conteo 51 bloqueado | PASS_AUTOMATED | runner `certify:f9b:auto-offline` |

## Evidencia ANALISTA / ADMIN

| Escenario | Estado | Evidencia |
|---|---|---|
| Supervisión | PASS | QA remoto + UI Android observada |
| Búsqueda operacional | PASS | QA remoto + UI observada |
| Corte 001 | PASS | READY, 3 snapshots, export_seq 1-3 |
| Descarga RP XLSX | PASS | signed URL + SHA/tamaño/contrato |
| Rectificación 001 | PASS | 2 → 3, idempotencia PASS |
| CUT_SNAPSHOT | PASS | artefacto READY |
| RECTIFICATION_XLSX | PASS | artefacto READY |
| CUT_READY_BACKUP | PASS | artefacto READY |
| Storage privado | PASS | escritura directa ANALISTA denegada |
| Freeze / lifecycle / auditoría | PASS | lifecycle validado |
| RLS por rol/assignment | PASS | CONTADOR/ANALISTA/ADMIN y sin assignment |

## Integridad

- pérdida de conteos observada: `0`;
- duplicados técnicos observados: `0`;
- corrupción de outbox observada: `0`;
- cortes superpuestos observados: `0`;
- replay idempotente: `PASS`;
- recuperación post-offline/reboot: `PASS`.

## Sign-off manual restante

Para transformar `BETA_MANUAL` en `PASS` falta exclusivamente registrar una observación humana final del candidato certificado, sin añadir nuevas funciones:

1. abrir el build `f9b-qa-2aa6645a`;
2. confirmar navegación básica y que no hay bloqueo visual/operacional evidente;
3. confirmar que CONTADOR puede guardar un conteo sintético;
4. confirmar que ANALISTA puede abrir Supervisión/Cortes;
5. confirmar que no aparece ningún error BLOCKER;
6. registrar operador, hora UTC y evidencia de cierre.

Hasta ese sign-off: `BETA_MANUAL = READY_FOR_MANUAL_SIGNOFF`.
