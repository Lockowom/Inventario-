# Evidencia F9B

Este directorio contiene las plantillas de los gates manuales/externos y el estado operativo del QA remoto de Fase 9. `ANDROID_PHYSICAL` quedó certificado en hardware real el 2026-09-27. Permanece abierto `IOS_PHYSICAL`. `ANDROID_PHYSICAL`, `BETA_MANUAL` y el gate RP real quedaron cerrados el 2026-09-27.

La provisión y sus controles están en [REMOTE_QA_PROVISIONING_MANIFEST.md](REMOTE_QA_PROVISIONING_MANIFEST.md). El estado ejecutado y los pendientes actuales están en [REMOTE_QA_EXECUTION_STATUS.md](REMOTE_QA_EXECUTION_STATUS.md). Ningún documento contiene secretos.

Usar un archivo JSON por ejecución basado en [EVIDENCE_SCHEMA.md](EVIDENCE_SCHEMA.md) y la plantilla del gate. Validar localmente con:

```text
node scripts/phase-9-manual-evidence-check.mjs ruta/al-registro.json
```

El comando sólo emite `EVIDENCE_COMPLETE` o `EVIDENCE_INCOMPLETE`; nunca certifica, aprueba ni genera un `PASS` automático.

| Gate | Plantilla | Estado inicial |
|---|---|---|
| Android físico | [ANDROID_EXECUTION_20260926_XIAOMI15T.md](ANDROID_EXECUTION_20260926_XIAOMI15T.md) | `PASS` |
| iOS virtual matrix | [IOS_VIRTUAL_EXECUTION_20260927.md](IOS_VIRTUAL_EXECUTION_20260927.md) | `PASS` — 23/23 |
| iOS native simulator build | [IOS_NATIVE_SIMULATOR_EXECUTION_20260928.md](IOS_NATIVE_SIMULATOR_EXECUTION_20260928.md) | `PASS` |
| iOS físico | [IOS_EXECUTION_TEMPLATE.md](IOS_EXECUTION_TEMPLATE.md) | `NOT_RUN` / `MANUAL_REQUIRED` |
| RP real / fuente real RP | [RP_SOURCE_EXECUTION_20260927.md](RP_SOURCE_EXECUTION_20260927.md) | `PASS_WITH_WARNINGS` |
| Beta interna | [BETA_EXECUTION_20260927.md](BETA_EXECUTION_20260927.md) | `PASS` |

No incluir credenciales, datos de producción ni evidencia ficticia.
