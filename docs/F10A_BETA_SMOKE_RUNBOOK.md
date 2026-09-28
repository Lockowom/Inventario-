# F10A — Beta Smoke Runbook

Objetivo: comprobar que el **artefacto Release QA/BETA** funciona después del empaquetado nativo. No repite la certificación exhaustiva F9.

## Precondiciones

- branch/candidato F10A;
- `environment = QA`;
- `channel = BETA`;
- `productionLocked = true`;
- usuario e inventario sintéticos QA;
- candidate evidence correspondiente a la plataforma;
- ningún dato productivo.

## Secuencia Android / iOS

1. Instalar el artefacto Release candidato.
2. Abrir INVEN3.
3. Confirmar en diagnóstico:
   - Supabase = `CONFIGURED`;
   - Entorno = `QA`;
   - Canal = `BETA`;
   - versión visible = `1.0.0-beta+...`.
4. Iniciar sesión con usuario QA sintético.
5. Confirmar que Health Check queda no bloqueante:
   - `READY`, `READY_OFFLINE` o `READY_WITH_WARNINGS`;
   - no aceptar `BLOCKED`.
6. Confirmar `CONTEO FÍSICO`.
7. Confirmar `MIS CONTEOS`.
8. Registrar exactamente un conteo sintético autorizado.
9. Confirmar `CONTEO GUARDADO`.
10. Sincronizar y confirmar que el mismo conteo llega a:
    - `Confirmado en servidor`.
11. Abrir scanner y cancelar.
12. Confirmar que cancelar scanner:
    - vuelve al formulario;
    - no guarda automáticamente otro conteo.
13. Registrar screenshots/logs/session IDs en `evidence_refs`.
14. Completar la plantilla JSON de la plataforma.

## Validar evidencia

Android:

```bash
npm run release:smoke:check -- docs/f10a/ANDROID_BETA_SMOKE_EXECUTION.json
```

iOS:

```bash
npm run release:smoke:check -- docs/f10a/IOS_BETA_SMOKE_EXECUTION.json
```

Resultado requerido:

```text
[PASS] F10A_BETA_SMOKE_EVIDENCE platform=<android|ios> status=PASS
[PASS] READY_FOR_F10A_CLOSURE
```

## Paridad

Antes del smoke, ambos candidate evidence deben pasar:

```bash
npm run release:verify-parity
```

Resultado:

```text
[PASS] F10A_PLATFORM_PARITY
```

## Cierre

Con ambas evidencias PASS:

```bash
npm run release:f10a:close -- \
  --android-candidate artifacts/release/INVEN3-android-candidate-evidence.json \
  --ios-candidate artifacts/release/INVEN3-ios-candidate-evidence.json \
  --parity artifacts/release/INVEN3-f10a-platform-parity.json \
  --android-smoke docs/f10a/ANDROID_BETA_SMOKE_EXECUTION.json \
  --ios-smoke docs/f10a/IOS_BETA_SMOKE_EXECUTION.json
```

Debe generar:

`artifacts/release/INVEN3-F10A-closure.json`

con:

```text
F10A_RELEASE_ENGINEERING = PASS
nextGate = F10B_NOT_AUTHORIZED
productionLocked = true
```

## Criterio de rechazo

No cerrar F10A si:

- identidad no es QA/BETA;
- Supabase no está configurado;
- Health queda BLOCKED;
- el conteo no se guarda;
- el conteo no se confirma;
- scanner cancelar auto-guarda;
- candidate SHA/build no coincide;
- paridad Android/iOS falla;
- existe BLOCKER/CRITICAL abierto;
- producción deja de estar bloqueada.

## Producción

Este runbook no autoriza:

- Supabase PROD;
- migraciones PROD;
- Google Play;
- TestFlight/App Store;
- rollout real;
- F10B.
