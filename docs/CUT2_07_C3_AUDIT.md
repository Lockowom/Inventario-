# CUT2-07 — Auditoría C3 existente

| Área | Clasificación | Hallazgo / decisión |
| --- | --- | --- |
| `recount_missions` | EXISTS_AND_VALID / TO_REUSE | Una sola familia para C2 y C3; no se crea tabla paralela. |
| `recount_mission_subtasks` y serial sweep | EXISTS_AND_VALID | Reutilizables para ubicación, lote, serie y evidencia offline. |
| `recount_mission_observations` | EXISTS_BUT_LEGACY | Sólo puente de clientes previos; C3 nuevo usa subtareas. |
| C2 → C3 | PARTIAL | El C2 ya creaba C3 idempotente por `(case_id, round)`, pero no guardaba C2 fuente explícita. |
| Source cut / sealed reference | PARTIAL | Existían en C2; CUT2-07 los propaga a C3. |
| Claim C3 | EXISTS_BUT_LEGACY | `RECOUNT_C3` ya es distinto de C2 por CUT2-06, pero faltaba separación del ejecutor C2. |
| Blindness | UNSAFE | El payload exponía `reference_value` a C3. CUT2-07 lo elimina de captura. |
| Completion C3 | UNSAFE | Una coincidencia de cantidad podía marcar el caso confirmado. CUT2-07 lo convierte en evidencia para decisión posterior. |
| Monitor | PARTIAL | Ya contaba C3 por estado; requiere conservar la cadena de origen para decisión/operación. |
| SLA C3 | MISSING | No existe una política C3 certificada; no se inventa una duración. C3 se monitorea por estado, no por SLA en esta fase. |
| ERP/RP | EXISTS_AND_VALID | Ninguna RPC de recount ajusta ERP ni libera RP; debe preservarse. |

## Decisiones

- C3 es captura física ciega y una evidencia formal, no voto mayoritario ni ajuste.
- La revisión de C1/C2/C3 queda fuera de la captura y pertenece al flujo posterior.
- La cadena canónica será `cut → sealed reference → C2 → C3` mediante claves, no texto libre.
