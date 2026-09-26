# Certificación INVEN3 v1 — Fase 9A

Este documento es la fuente autoritativa de certificación F9. Un estado `PASS` requiere ejecución y evidencia reproducible; los gates físicos, de RP y beta no se reinterpretan como automatizados.

Certified SHA: `d536d364c3488de2a20cbc870079c5992f923c47`
Certified CI run: [`36189000875`](https://github.com/Lockowom/Inventario-/actions/runs/36189000875)

| AREA | SCENARIO | TYPE | METHOD | PASS CRITERIA | EVIDENCE | STATUS |
|---|---|---|---|---|---|---|
| LOAD | 47 dispositivos × 50 pendientes × 3 olas | AUTOMATED | `phase-9-load-certification.mjs` | 7.050 ACK, 0 pérdidas, UUID persistidos únicos, 20+20+10 | CI 36189000875/phase-9-load: 47 usuarios/dispositivos, 7.050, 3 olas, 0 pérdidas | PASS |
| LOAD | 100 usuarios CONTADOR × 1 dispositivo × 20 registros | AUTOMATED | `phase-9-load-certification.mjs` | 2.000 ACK; 0 rechazados/fallidos; 0 UUID duplicados; 0 ownership cruzado | CI 36189000875/phase-9-load: `Promise.all(100)`, máximo 20 por batch, 100/100/2.000 | PASS |
| LOAD | Reuso de dispositivo entre usuarios | AUTOMATED | harness de carga | otro contador recibe rechazo de registro | CI 36189000875/phase-9-load | PASS |
| LOAD | sync, replay ACK, late arrival, corrección y corte | AUTOMATED | F4/F6 harness conservado | invariantes de corte y replay sin pérdida | CI 36189000875/phase-9-load | PASS |
| OFFLINE | guardar sin red, backend temporalmente caído y retry | AUTOMATED | `phase-9-offline-certification.test.ts` | payload durable; fallo transitorio no elimina UUID | CI 36189000875/app-checks | PASS |
| OFFLINE | cerrar/reabrir y restaurar 50 pendientes | AUTOMATED | Dexie real en test | mismos UUID, 20+20+10 y ACK exactos tras restart | CI 36189000875/app-checks | PASS |
| OFFLINE | umbrales 0–39, 40, 45, 50 | AUTOMATED | estado usado por UI | mensajes funcionales correctos y bloqueo en 50 | CI 36189000875/app-checks + phase-9-e2e-visual | PASS |
| OFFLINE | freeze con pendientes conocidos | AUTOMATED | F4/F6 y pgTAP existentes | bloquea >0; se resuelve tras reportar 0 | CI 36189000875/database-checks | PASS |
| DEVICES | build, Capacitor, plugins y configuración | AUTOMATED | `app-checks` + inspección estática | Android/iOS sync; SQLite y scanner configurados | CI 36189000875/app-checks | PASS |
| DEVICES | Device Health Check | CONTRACT | `DEVICE_HEALTH_CHECK_V1.md` | contrato listo para implementación; no ejecuta diagnóstico | contrato F9A | CONTRACT_READY / NOT_IMPLEMENTED |
| DEVICES | cámara, scanner, SQLite y safe areas reales | MANUAL_PHYSICAL | `DEVICE_QA_V1.md` | checklist por Android/iOS ejecutado en hardware | evidencia QA | MANUAL_REQUIRED |
| VISUAL | viewports 320,360,390,412,420,430,600,768,900,1024,1440 | AUTOMATED | Playwright e2e sobre flujo real de Cortes | sin overflow horizontal; `VER DETALLE`, detalle inmutable, rectificación y artefacto visibles | CI 36189000875/phase-9-e2e-visual | PASS |
| VISUAL | conteo 320,390,412,430 | AUTOMATED | Playwright e2e | sin overflow; Guardar visible; mensajes 40/45/50 y `Mis conteos`; bloqueo en 50 | CI 36189000875/phase-9-e2e-visual | PASS |
| VISUAL | conteo, mis conteos, supervisión, cortes, detalle, rectificación, evidencias y maestro | AUTOMATED | fixture determinista | headings, labels y controles críticos visibles | CI 36189000875/phase-9-e2e-visual | PASS |
| VISUAL | snapshots representativos | AUTOMATED | Playwright visual | snapshots estables 320/768/1440, sin animación/datos variables | CI 36189000875/phase-9-e2e-visual | PASS |
| VISUAL | smoke de accesibilidad | AUTOMATED | roles, labels, fieldset, aria-live y tab stops | controles principales encontrables | CI 36189000875/phase-9-e2e-visual | PASS |
| RP | XLSX oficial Edge→Storage→download | AUTOMATED | F7 harness | 9 columnas, orden, ceros, fecha, blanks, cantidad, sin fórmulas, SHA | CI 36189000875/phase-7-edge-storage | PASS |
| RP | importación real Softland/RP | EXTERNAL_RP | `RP_ACCEPTANCE_V1.md` | importación controlada documentada | evidencia RP | BLOCKED_EXTERNAL |
| BETA | aceptación interna no productiva | BETA | `BETA_ACCEPTANCE_V1.md` | checklist humano sobre fixtures | evidencia beta | MANUAL_REQUIRED |
| SECURITY | RLS/advisors/audit | AUTOMATED | pgTAP, advisors, npm audit | sin regresión de seguridad ni vulnerabilidades prod | CI 36189000875/database-checks + app-checks | PASS |
| REGRESSION | F0–F8 | AUTOMATED | jobs existentes | unit, pgTAP, F4/F6, F7, F8 conservados | CI 36189000875/app-checks + database-checks + phase-7-edge-storage + phase-8-edge-storage | PASS |

## Alcance y límites

- F9A no agrega conciliación, stock RP, diferencias, ajustes, valorización, SCI, roles ni tablas de negocio.
- La carga usa datos efímeros de Supabase local y no enlaza, aplica ni consulta Supabase remoto.
- El benchmark registra integridad como criterio primario; tiempo, records/s y RSS son observaciones, no SLA contractual.
- Device Health permanece `CONTRACT_READY / NOT_IMPLEMENTED`: F9A.4A agrega sólo dominio, adapters no visuales y una RPC mínima certificada; no agrega UI, gatillo de captura, RLS adicional ni telemetría.
- La cobertura visual usa el fixture de compilación `VITE_CERTIFICATION_FIXTURE=1` sólo cuando `import.meta.env.DEV` es verdadero; un build productivo siempre renderiza `RuntimeApp`. Sus datos sintéticos son deterministas y contractualmente válidos.
- `SUPERVISION_LAYOUT_SMOKE = PASS` en CI 36189000875/phase-9-e2e-visual. Los estados de datos de supervisión se certifican por las pruebas unitarias e integración existentes, no se declaran ejecutados por Playwright.

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
