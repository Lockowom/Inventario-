# Evidencia F9B

Este directorio contiene esquemas y plantillas vacías para los gates manuales/externos de Fase 9. No contiene evidencia real ni cambia el estado de ningún gate.

La secuencia futura para un QA remoto autorizado, sus cuatro Edge Functions, configuración pública de build, usuarios y fixture sintética está en [REMOTE_QA_PROVISIONING_MANIFEST.md](REMOTE_QA_PROVISIONING_MANIFEST.md). Es planificación: no contiene secretos ni autoriza acciones remotas.

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
