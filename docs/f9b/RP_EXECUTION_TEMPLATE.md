# Plantilla de importación real RP

Estado inicial: `NOT_RUN`; el gate de certificación permanece `BLOCKED_EXTERNAL` hasta una importación humana autorizada. Codex no opera Softland/RP.

## Registro obligatorio

| Campo | Valor de ejecución |
|---|---|
| execution_id / status | / `NOT_RUN` |
| candidate_sha / build_sha / app_version | |
| operator / environment_name / environment_type | |
| cut_id / cut_number | |
| file_name / sha256 / size_bytes / record_count | |
| generated_at / started_at / finished_at UTC | |
| rp_environment | `TEST`, `SANDBOX` o `AUTHORIZED_CONTROLLED` |
| rows_total / rows_accepted / rows_rejected | |
| warnings / errors / rp_messages | |
| evidence_refs / defects / notes | |

Si sólo hay producción o no existe autorización explícita, registrar `BLOCKED`; no importar.

## Dataset de control

Confirmar en el XLSX: control `SERIAL`, `PARTIDA` y `LEGACY`; `CODIGO` con ceros iniciales; `SERIE` como texto; `PARTIDA` `00725`; `PIEZA` `001234`; fecha Excel real, fecha vacía, talla, color, blanks, cantidad entera y cero fórmulas.

## Criterios de resultado

Registrar mensajes exactos de RP y referencias de evidencia. Errores de fecha RP, lotes alterados o ceros iniciales alterados deben ser cero para un resultado satisfactorio. Esta prueba no concilia stock ni autoriza cambios de stock.
