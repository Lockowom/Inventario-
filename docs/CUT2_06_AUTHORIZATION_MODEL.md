# CUT2-06 — Modelo de autorización canónico

La decisión server-side es `CAN(actor, action, resource)`. Nunca se deriva
solamente de un botón visible ni de un nombre de rol.

| Acción | Capability | Scope | Offline | Guard servidor | UI |
| --- | --- | --- | --- | --- | --- |
| Capturar C1 | `COUNT_C1` | Inventario + bodega | Snapshot C1 verificado | `sync_counts` revalida | Habilita captura sólo con contexto válido |
| Corregir C1 propio | `COUNT_C1` | Inventario + bodega | No | `correct_uncut_count` | Sólo indicativa |
| Corregir evidencia ajena | `MANAGE_RECONCILIATION` | Inventario + bodega | No | `correct_uncut_count` | Sólo indicativa |
| Claim C2 | `RECOUNT_C2` | Inventario + bodega | Sí, evidencia revalidada al sync | `claim_next_recount_mission` | Cola ciega |
| Claim C3 | `RECOUNT_C3` | Inventario + bodega | Sí, evidencia revalidada al sync | `claim_next_recount_mission` | Cola ciega |
| Reasignar/SLA C2 | `REASSIGN_C2` | Inventario + bodega | No | RPC C2 operacionales | Botón no autoritativo |
| Preview rolling | `ROLLING_CUT_PREVIEW` | Inventario + bodega | No | `preview_rolling_cut_v2_base` | Sólo indicativa |
| Crear rolling cut | `ROLLING_CUT_CREATE` | Inventario + bodega | No | `create_rolling_cut_v2` | Sólo indicativa |
| Ver Monitor | `VIEW_MONITOR` | Inventario + bodega | No | Read-models Monitor | Ruta intenta lectura server-side |
| Administrar usuarios | `MANAGE_USERS` + `MANAGE_ASSIGNMENTS` | Inventario administrable | No | Scope JWT + segunda validación Edge | Ruta no concede permisos |

`GLOBAL` sólo existe como policy explícita. `INVENTORY` no lleva bodega y
`WAREHOUSE` debe coincidir con la bodega real del inventario. Ausencia de
capability, scope ambiguo, usuario inactivo, user type incompatible o
assignment fuera de vigencia siempre resultan en deny.

Los tipos de usuario son una restricción adicional: `EXTERNAL_AUDITOR` es
read-only, `TEMPORARY` sólo recibe C1 por policy default y `CONTRACTOR_3PL`
queda limitado a las capabilities explícitamente permitidas. Un grant que
contradice el allowlist se rechaza en el servidor.

El snapshot offline es propiedad del actor e incluye actor, user type,
capabilities, inventario, bodega, `verified_at` y `schema_version`. Una
revocación conocida en el servidor no acepta el sync; el cliente conserva la
evidencia como `REVIEW_REQUIRED` con `AUTHORIZATION_REVOKED`, sin reintentos.
