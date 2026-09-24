# Certificación INVEN3 v1 — Fase 9A

Este documento es la fuente autoritativa de certificación F9. Un estado `PASS` requiere ejecución y evidencia reproducible; los gates físicos, de RP y beta no se reinterpretan como automatizados.

| AREA | SCENARIO | TYPE | METHOD | PASS CRITERIA | EVIDENCE | STATUS |
|---|---|---|---|---|---|---|
| LOAD | 47 dispositivos × 50 pendientes × 3 olas | AUTOMATED | `phase-9-load-certification.mjs` | 7.050 ACK, 0 pérdidas, UUID persistidos únicos, 20+20+10 | job `phase-9-load` | NOT_RUN |
| LOAD | Reuso de dispositivo entre usuarios | AUTOMATED | harness de carga | otro contador recibe rechazo de registro | job `phase-9-load` | NOT_RUN |
| LOAD | sync, replay ACK, late arrival, corrección y corte | AUTOMATED | F4/F6 harness conservado | invariantes de corte y replay sin pérdida | `database-checks` | NOT_RUN |
| OFFLINE | guardar sin red, backend temporalmente caído y retry | AUTOMATED | `phase-9-offline-certification.test.ts` | payload durable; fallo transitorio no elimina UUID | unit test | NOT_RUN |
| OFFLINE | cerrar/reabrir y restaurar 50 pendientes | AUTOMATED | Dexie real en test | mismos UUID, 20+20+10 y ACK exactos tras restart | unit test | NOT_RUN |
| OFFLINE | umbrales 0–39, 40, 45, 50 | AUTOMATED | estado usado por UI | mensajes funcionales correctos y bloqueo en 50 | unit test | NOT_RUN |
| OFFLINE | freeze con pendientes conocidos | AUTOMATED | F4/F6 y pgTAP existentes | bloquea >0; se resuelve tras reportar 0 | database harness | NOT_RUN |
| DEVICES | build, Capacitor, plugins y configuración | AUTOMATED | `app-checks` + inspección estática | Android/iOS sync; SQLite y scanner configurados | CI | NOT_RUN |
| DEVICES | cámara, scanner, SQLite y safe areas reales | MANUAL_PHYSICAL | `DEVICE_QA_V1.md` | checklist por Android/iOS ejecutado en hardware | evidencia QA | MANUAL_REQUIRED |
| VISUAL | viewports 320,360,420,600,768,900,1024,1440 | AUTOMATED | Playwright e2e | sin overflow horizontal, controles visibles y usables | `phase-9-e2e-visual` | NOT_RUN |
| VISUAL | conteo, mis conteos, supervisión, cortes, detalle, rectificación, evidencias y maestro | AUTOMATED | fixture determinista | headings, labels y controles críticos visibles | e2e/visual | NOT_RUN |
| VISUAL | snapshots representativos | AUTOMATED | Playwright visual | snapshots estables 320/768/1440, sin animación/datos variables | `tests/visual` | NOT_RUN |
| VISUAL | smoke de accesibilidad | AUTOMATED | roles, labels, fieldset, aria-live y tab stops | controles principales encontrables | `tests/e2e` | NOT_RUN |
| RP | XLSX oficial Edge→Storage→download | AUTOMATED | F7 harness | 9 columnas, orden, ceros, fecha, blanks, cantidad, sin fórmulas, SHA | `phase-7-edge-storage` | NOT_RUN |
| RP | importación real Softland/RP | EXTERNAL_RP | `RP_ACCEPTANCE_V1.md` | importación controlada documentada | evidencia RP | BLOCKED_EXTERNAL |
| BETA | aceptación interna no productiva | BETA | `BETA_ACCEPTANCE_V1.md` | checklist humano sobre fixtures | evidencia beta | MANUAL_REQUIRED |
| SECURITY | RLS/advisors/audit | AUTOMATED | pgTAP, advisors, npm audit | sin regresión de seguridad ni vulnerabilidades prod | CI | NOT_RUN |
| REGRESSION | F0–F8 | AUTOMATED | jobs existentes | unit, pgTAP, F4/F6, F7, F8 conservados | CI | NOT_RUN |

## Alcance y límites

- F9A no agrega conciliación, stock RP, diferencias, ajustes, valorización, SCI, roles ni tablas de negocio.
- La carga usa datos efímeros de Supabase local y no enlaza, aplica ni consulta Supabase remoto.
- El benchmark registra integridad como criterio primario; tiempo, records/s y RSS son observaciones, no SLA contractual.
- La cobertura visual usa el fixture de compilación `VITE_CERTIFICATION_FIXTURE=1`, que sólo existe durante Playwright y contiene datos sintéticos deterministas.

## Resumen emitido por CI

Tras los jobs automatizados, `phase-9-certification-summary` debe emitir:

```text
INVEN3 PHASE 9 CERTIFICATION
LOAD              PASS/FAIL
OFFLINE           PASS/FAIL
VISUAL            PASS/FAIL
RP_AUTOMATED      PASS/FAIL
ANDROID_AUTOMATED PASS/FAIL
IOS_AUTOMATED     PASS/FAIL

ANDROID_PHYSICAL  MANUAL_REQUIRED
IOS_PHYSICAL      MANUAL_REQUIRED
RP_REAL_IMPORT    BLOCKED_EXTERNAL
BETA_MANUAL       MANUAL_REQUIRED
```
