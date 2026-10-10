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
| iOS virtual matrix | PASS | 23/23 perfiles WebKit iPhone 11→18; touch/overflow/Health/Conteo PASS |
| iOS native simulator build | PASS | Codemagic Mac mini M2; Xcode 26.4; `App.app.zip` 11.88 MB; build `6ab9b05e12dce3b0c7bbb318` |
| iOS device package build | PASS | `iphoneos`; `INVEN3-F9-unsigned-device.ipa` 10.91 MB; build `6ab9b269046f1cf182301e75` |
| iOS physical launch | PASS | BrowserStack real iPhone: package installed and INVEN3 launched; platform reports `ios`, local storage READY |
| iOS físico | DEFERRED_NON_BLOCKING | real iPhone BrowserStack: launch PASS; Supabase CONFIGURED; build `f9b-ios-qa-38992a0`; sesión autenticada y UI conteo/scanner renderizadas. Ciclo offline físico completo queda diferido; no se declara PASS. Decisión de alcance aprobada por el owner el 2026-09-28 para continuar desarrollo. |
| RP real import | PASS_WITH_WARNINGS | archivo real RP certificado como gate oficial RP→INVEN3; conciliación 0 diferencias; evidencia `RP-SOURCE-20260927T162115.json` |
| Beta interna | PASS | sign-off humano final aprobado; evidencia `BETA-F9B-20260927T154621.json` |
| Release candidate freeze | PASS | `release/f9-rc1` fijada al candidato certificado |
| CI final release candidate | PENDING | ejecutar cuando los gates obligatorios estén cerrados |

## Bloqueadores de cierre total F9

Para el cierre operativo de F9, `IOS_PHYSICAL` queda explícitamente diferido como gate no bloqueante por decisión del owner del 2026-09-28. No se convierte en PASS y mantiene deuda de evidencia física offline.

El único bloqueador restante para congelar el candidato final de F9 es:

- CI final del release candidate.

## Regla de avance

No convertir gates diferidos en PASS sin evidencia. La decisión del 2026-09-28 permite continuar desarrollo pese a la deuda `IOS_PHYSICAL`; F10 sigue `NOT_STARTED` hasta apertura explícita de alcance.


## Comando de sign-off beta

El cierre humano mínimo de beta quedó guiado y registrable con:

`npm run certify:f9b:beta-signoff`

El comando no inventa PASS: solicita confirmación S/N de navegación, guardado CONTADOR, Supervisión/Cortes ANALISTA, ausencia de BLOCKER e identidad exacta del candidato; genera evidencia JSON en `artifacts/f9b-beta/`.


## Fuente RP real certificada

El dataset real `STOCK RP(2).xlsx` quedó certificado como fuente de prueba con SHA-256 `6b43ab792ca73210888c316c2886d373a7d4b937f22f3b0145ce272c36f54fa3`.

Esto elimina la incertidumbre del formato real de entrada RP y valida el universo de SKU/lotes/series contra el contrato de INVEN3. Por decisión de alcance de F9, esta ejecución constituye el gate oficial `RP_REAL_IMPORT = PASS_WITH_WARNINGS`. Una prueba inversa INVEN3→RP no es bloqueador de F9 y deberá tratarse como gate separado si se incorpora posteriormente.
