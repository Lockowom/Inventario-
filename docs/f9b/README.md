# Evidencia F9B

Este directorio contiene las plantillas de los gates manuales/externos y el estado operativo del QA remoto de Fase 9. Los gates físicos, RP real y beta siguen sin aprobarse.

La provisión y sus controles están en [REMOTE_QA_PROVISIONING_MANIFEST.md](REMOTE_QA_PROVISIONING_MANIFEST.md). El estado ejecutado y los pendientes actuales están en [REMOTE_QA_EXECUTION_STATUS.md](REMOTE_QA_EXECUTION_STATUS.md). Ningún documento contiene secretos.

Usar un archivo JSON por ejecución basado en [EVIDENCE_SCHEMA.md](EVIDENCE_SCHEMA.md) y la plantilla del gate. Validar localmente con:

```text
node scripts/phase-9-manual-evidence-check.mjs ruta/al-registro.json
```

El comando sólo emite `EVIDENCE_COMPLETE` o `EVIDENCE_INCOMPLETE`; nunca certifica, aprueba ni genera un `PASS` automático.

| Gate | Plantilla | Estado inicial |
|---|---|---|
| Android físico | [ANDROID_EXECUTION_TEMPLATE.md](ANDROID_EXECUTION_TEMPLATE.md) | `NOT_RUN` / `MANUAL_REQUIRED` |
| iOS físico | [IOS_EXECUTION_TEMPLATE.md](IOS_EXECUTION_TEMPLATE.md) | `NOT_RUN` / `MANUAL_REQUIRED` |
| Importación real RP | [RP_EXECUTION_TEMPLATE.md](RP_EXECUTION_TEMPLATE.md) | `NOT_RUN` / `BLOCKED_EXTERNAL` |
| Beta interna | [BETA_EXECUTION_TEMPLATE.md](BETA_EXECUTION_TEMPLATE.md) | `NOT_RUN` / `MANUAL_REQUIRED` |

No incluir credenciales, datos de producción ni evidencia ficticia.
