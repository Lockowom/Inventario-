# Paquete de ejecución manual/externa — Fase 9B

Este paquete coordina los gates manuales/externos y el QA remoto autorizado de F9B. Las ejecuciones ya realizadas se registran como evidencia; este paquete no autoriza producción, rollout ni Fase 10.

## Baseline y estado de candidato

- Baseline funcional automatizado: `8790127f7b676612d888936627233431efe93ac4`.
- Baseline de provisión remota documentada: `24cdf452bb333fdaa1271d6305fc41c6c8475adc`.
- CI de ese baseline remoto: `36219870396`, completa en verde.
- `FINAL_RELEASE_CANDIDATE_SHA = NOT_FROZEN`; se fijará sólo después de cerrar QA remoto y los gates manuales/externos aplicables.

## Estado de gates manuales/externos

| Gate | Estado actual | Evidencia |
|---|---|---|
| `ANDROID_PHYSICAL` | `PASS` | [Xiaomi 15T](f9b/ANDROID_EXECUTION_20260926_XIAOMI15T.md) |
| `IOS_PHYSICAL` | `DEFERRED_NON_BLOCKING` | iPhone real BrowserStack con instalación/arranque/configuración QA; offline exhaustivo diferido, sin falso PASS |
| `RP_REAL_IMPORT` | `PASS_WITH_WARNINGS` | [RP real](f9b/RP_SOURCE_EXECUTION_20260927.md) |
| `BETA_MANUAL` | `PASS` | [Beta](f9b/BETA_EXECUTION_20260927.md) |

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

La fixture `INVEN3-QA` ya cubre Auth/profiles/assignments, maestro SERIAL/PARTIDA/LEGACY, ciclo hasta `ABIERTO`, tres conteos, replay idempotente, rechazos contractuales, RLS y `CORTE 001` en `READY`. Las cuatro Edge Functions están activas con JWT obligatorio.

Los gates remotos F9B ya ejecutados son:

- `F9B_REMOTE_RP_PASS`: CUT_XLSX oficial, Storage privado, signed download, SHA-256, tamaño y contrato XLSX.
- `F9B_REMOTE_F8_PASS`: SNAPSHOT, RECTIFICATION_XLSX, CUT_READY_BACKUP, idempotencia, contratos JSON/XLSX/ZIP, as-of, RLS/Storage denials y auditoría.

La evidencia consolidada está en [REMOTE_QA_EXECUTION_STATUS.md](f9b/REMOTE_QA_EXECUTION_STATUS.md).

## Ejecución remota autenticada

Los runners quedan disponibles para reproducción controlada exclusivamente contra `INVEN3-QA`:

```text
npm run certify:f9b:remote-rp
npm run certify:f9b:remote-f8
```

`remote-rp` requiere sesión real de `QA ANALISTA`. `remote-f8` requiere sesiones reales de `QA ANALISTA` y `QA ADMIN` porque los technical backups son admin-only. Ninguno admite service-role como sustituto de sesión de usuario y ambos se niegan a ejecutar fuera de `INVEN3-QA`.

Las credenciales, JWT, keys administrativas y URLs firmadas no se incluyen en evidencia ni se pegan en tickets/chat. La fixture principal permanece `ABIERTO`; no se cierra ni congela hasta completar los gates físicos/manuales que dependen de ella.
