# Paquete de ejecución manual/externa — Fase 9B

Este paquete coordina los gates que CI no puede completar por sí sola y el QA remoto ya autorizado. No aprueba Android/iOS físicos, RP real, beta, producción, rollout ni Fase 10.

## Baseline y estado de candidato

- Baseline funcional automatizado: `8790127f7b676612d888936627233431efe93ac4`.
- Baseline de provisión remota documentada: `24cdf452bb333fdaa1271d6305fc41c6c8475adc`.
- CI de ese baseline remoto: `36219870396`, completa en verde.
- `FINAL_RELEASE_CANDIDATE_SHA = NOT_FROZEN`; se fijará sólo después de cerrar QA remoto y los gates manuales/externos aplicables.

## Gates pendientes

| Gate | Estado actual | Ejecutor | Paquete |
|---|---|---|---|
| `ANDROID_PHYSICAL` | `MANUAL_REQUIRED` | operador de QA con dispositivo físico | [DEVICE_QA_V1.md](DEVICE_QA_V1.md), [Android template](f9b/ANDROID_EXECUTION_TEMPLATE.md) |
| `IOS_PHYSICAL` | `MANUAL_REQUIRED` | operador de QA con dispositivo físico | [DEVICE_QA_V1.md](DEVICE_QA_V1.md), [iOS template](f9b/IOS_EXECUTION_TEMPLATE.md) |
| `RP_REAL_IMPORT` | `BLOCKED_EXTERNAL` | operador autorizado de RP/Softland | [RP_ACCEPTANCE_V1.md](RP_ACCEPTANCE_V1.md), [RP template](f9b/RP_EXECUTION_TEMPLATE.md) |
| `BETA_MANUAL` | `MANUAL_REQUIRED` | participantes internos designados | [BETA_ACCEPTANCE_V1.md](BETA_ACCEPTANCE_V1.md), [beta template](f9b/BETA_EXECUTION_TEMPLATE.md) |

Los estados de ejecución permitidos en los registros son `NOT_RUN`, `PASS`, `FAIL` y `BLOCKED`. Un resultado `PASS` requiere evidencia y no admite defectos `BLOCKER` o `CRITICAL` abiertos. La evidencia se registra con el [schema](f9b/EVIDENCE_SCHEMA.md) y puede verificarse localmente con `node scripts/phase-9-manual-evidence-check.mjs <archivo.json>`.

## Secuencia de ejecución

1. Crear un registro por gate desde la plantilla correspondiente, usando usuarios, inventarios y datos de prueba.
2. Registrar candidato, build, operador, ambiente y referencias de evidencia antes de concluir el gate.
3. Ejecutar sólo el procedimiento de la plantilla. Un emulador o simulador no satisface un gate físico.
4. Registrar cada defecto conforme al schema y repetir la prueba cuando corresponda.
5. Ejecutar el validador local. `EVIDENCE_COMPLETE` sólo confirma que el expediente está completo; no significa certificado ni aprobado.
6. Una autoridad humana revisa el expediente. Si la ejecución necesita Supabase remoto, RP o producción sin autorización explícita, registrar `BLOCKED` y detenerse.

## Fuentes coordinadas

- [DEVICE_HEALTH_CHECK_V1.md](DEVICE_HEALTH_CHECK_V1.md): contrato implementado; validación física pendiente.
- [CERTIFICATION_V1.md](CERTIFICATION_V1.md): fuente autoritativa de estados de certificación.
- [DEVICE_QA_V1.md](DEVICE_QA_V1.md): matriz de dispositivos y checklist físico.
- [RP_ACCEPTANCE_V1.md](RP_ACCEPTANCE_V1.md): importación humana y controlada de RP.
- [BETA_ACCEPTANCE_V1.md](BETA_ACCEPTANCE_V1.md): aceptación interna no productiva.

No se ejecuta una importación de RP, beta, instalación física ni acción de Supabase remoto como parte de este paquete.


## Estado remoto ejecutado

La fixture `INVEN3-QA` ya cubre Auth/profiles/assignments, maestro SERIAL/PARTIDA/LEGACY, ciclo hasta `ABIERTO`, tres conteos, replay idempotente, rechazos contractuales, RLS y `CORTE 001` en `SNAPSHOT_CREATED`. Las cuatro Edge Functions están activas con JWT obligatorio.

La siguiente frontera remota es autenticar una sesión QA real desde el runtime, generar el XLSX del corte, verificar SHA/tamaño/Storage y comprobar descarga firmada. Ver [REMOTE_QA_EXECUTION_STATUS.md](f9b/REMOTE_QA_EXECUTION_STATUS.md).

## Ejecución RP remota autenticada

Cuando las credenciales sintéticas estén disponibles en el entorno local del operador, ejecutar:

```text
npm run certify:f9b:remote-rp
```

El proceso requiere sesión real de `QA ANALISTA`, no admite service-role como sustituto y se niega a ejecutar fuera de `INVEN3-QA`. Las credenciales y URLs firmadas no se incluyen en evidencia ni se pegan en tickets/chat.
