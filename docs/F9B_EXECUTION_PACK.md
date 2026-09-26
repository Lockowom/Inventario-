# Paquete de ejecución manual/externa — Fase 9B.1

Este paquete está preparado para coordinar gates que CI no puede ejecutar. No contiene evidencia de ejecución, no aprueba gates y no autoriza producción, rollout ni Fase 10.

## Baseline autorizado

- Candidate SHA: `82a92f60f14a9e56014cf4825fafb7bdf7b9582e`
- Baseline funcional: `8790127f7b676612d888936627233431efe93ac4`
- CI final: [`36211601887`](https://github.com/Lockowom/Inventario-/actions/runs/36211601887)

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
