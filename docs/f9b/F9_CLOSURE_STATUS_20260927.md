# F9 — estado de cierre al 2026-09-27

## Candidato funcional certificado

- product candidate: `2aa6645ab89c5e74dc12c9475019880aca65564f`
- Android app version: `f9b-qa-2aa6645a`
- rama release candidate congelada: `release/f9-rc1` → `2aa6645ab89c5e74dc12c9475019880aca65564f`
- rama de evidencia/tooling: `feature/fase-9-certification`
- entorno: `INVEN3-QA`
- F10: `NOT_STARTED`

## Gate ledger

| Gate | Estado | Observación |
|---|---|---|
| QA migrations / hardening | PASS | 21/21 |
| Edge 4/4 | PASS | ACTIVE + verify_jwt |
| Auth/profiles/assignments | PASS | 3 identidades sintéticas |
| Master / lifecycle / RLS | PASS | fixture QA |
| Sync/idempotencia | PASS | incluida recuperación offline |
| RP CUT_XLSX remoto | PASS | contrato/SHA/tamaño |
| F8 artefactos/rectificación | PASS | snapshot/xlsx/backup |
| Android físico | PASS | Xiaomi 15T |
| iOS físico | MANUAL_REQUIRED | no certificado todavía |
| RP real import | BLOCKED_EXTERNAL | requiere operador RP/Softland autorizado |
| Beta interna | READY_FOR_MANUAL_SIGNOFF | matriz consolidada completa; falta cierre humano |
| Release candidate freeze | PASS | `release/f9-rc1` fijada al candidato certificado |
| CI final release candidate | PENDING | ejecutar cuando los gates obligatorios estén cerrados |

## Bloqueadores de cierre total F9

F9 no debe declararse completa mientras cualquiera de estos gates siga abierto:

- `IOS_PHYSICAL`;
- `RP_REAL_IMPORT`;
- `BETA_MANUAL`;
- CI final del release candidate.

## Regla de avance

No iniciar F10 por cierre implícito. Si un gate se decide explícitamente como no aplicable para el release, esa decisión debe documentarse como excepción aprobada; no convertir `MANUAL_REQUIRED` o `BLOCKED_EXTERNAL` en PASS sin evidencia.


## Comando de sign-off beta

El cierre humano mínimo de beta quedó guiado y registrable con:

`npm run certify:f9b:beta-signoff`

El comando no inventa PASS: solicita confirmación S/N de navegación, guardado CONTADOR, Supervisión/Cortes ANALISTA, ausencia de BLOCKER e identidad exacta del candidato; genera evidencia JSON en `artifacts/f9b-beta/`.
