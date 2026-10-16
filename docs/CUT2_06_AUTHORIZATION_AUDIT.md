# CUT2-06 — Auditoría de autorización

## Modelo encontrado

CUT2-01 ya aporta `cut2_user_type`, `cut2_capability_scope`,
`inventory_capability_grants`, asignaciones de inventario con vigencia y
`cut2_has_capability`. No se creó un RBAC paralelo: CUT2-06 consolida esos
objetos como la fuente canónica de capabilities y scope.

| Hallazgo | Estado | Tratamiento CUT2-06 |
| --- | --- | --- |
| Profile activo + `require_active_actor` | CORRECTO / MUST_PRESERVE | Mantener como precondición de toda RPC. |
| `inventory_assignments` con `active`, `valid_from`, `valid_until` | CORRECTO | La matriz canónica exige vigencia para scopes INVENTORY/WAREHOUSE. |
| `inventory_capability_grants` | DUPLICADO PARCIAL | Se reutiliza como override explícito y se le agrega guard de user type/scope. |
| `cut2_has_capability` con casos por rol | INCONSISTENTE | Reemplazado por `actor_has_capability` y matriz auditable. |
| C1 `sync_counts` + corrección | SCOPE_MISSING | Migrado a `COUNT_C1` o `MANAGE_RECONCILIATION` scoped; C2/C3 se valida por misión. |
| C2 claim, cola, SLA y reasignación | ROLE_ONLY | Migrado a `RECOUNT_C2`/`RECOUNT_C3`, `REASSIGN_C2` y `VIEW_MONITOR`; conserva `SKIP LOCKED` y ceguera. |
| Rolling preview/create | ROLE_ONLY | Migrado separadamente a `ROLLING_CUT_PREVIEW` y `ROLLING_CUT_CREATE`. |
| Monitor/read-models | SCOPE_MISSING | Migrado a `VIEW_MONITOR`; los agregados se calculan sólo después del guard scoped. |
| Edge `manage-users` valida sólo ADMIN | SERVER_ONLY / CAPABILITY_MISSING | Migrado a scope emitido por servidor y segunda validación service-role de `MANAGE_USERS` + `MANAGE_ASSIGNMENTS`. |
| Menú, pantallas y paneles con checks de rol | FRONTEND_ONLY | Rol sigue siendo metadata de presentación heredada. Monitor y Usuarios ya no lo toman como autoridad; el resto queda inventariado para migración incremental sin alterar otros módulos. |
| C2 claim con SKIP LOCKED, ceguera y separación | CORRECTO / MUST_PRESERVE | CUT2-06 sólo suma capability scoped; no altera sus invariantes. |

## Reglas canónicas

- Deny-by-default: actor inactivo, capability ausente, assignment vencida o
  scope no coincidente deniegan.
- `GLOBAL` es explícito en una policy; `INVENTORY` no puede llevar
  `warehouse_id`; `WAREHOUSE` debe coincidir con la bodega real del recurso.
- `PERMANENT` puede recibir capabilities permitidas. `CONTRACTOR_3PL` queda
  limitado a C1/C2/reporte; `TEMPORARY` a C1; `EXTERNAL_AUDITOR` es lectura.
- Una capability sólo se concede por la matriz default auditable o por un
  grant explícito vigente. El frontend no es fuente de autoridad.
- Los snapshots offline deben conservar actor, capabilities, scope, versión y
  `verified_at`; el servidor revalida cada sync y una revocación no produce
  una escritura C1 autorizada.

## Reauditoría dirigida de checks sensibles

| Check | Archivo/área | Categoría | Autoridad actual | Resultado CUT2-06 |
| --- | --- | --- | --- | --- |
| `sync_counts` | C1/offline sync | RPC AUTHORIZATION | Capability + inventory/warehouse scope + estado | MIGRATED |
| `correct_uncut_count` | C1 corrections | RPC AUTHORIZATION | `COUNT_C1` propio / `MANAGE_RECONCILIATION` ajeno | MIGRATED |
| `claim_next_recount_mission` | C2/C3 | RPC AUTHORIZATION | Capability, scope, separación de originador | MIGRATED |
| SLA/reassign | C2 operativo | RPC AUTHORIZATION | `REASSIGN_C2`, scope, evidencia de inicio | MIGRATED |
| preview/create cut | Rolling cut | RPC AUTHORIZATION | Capabilities independientes | MIGRATED |
| Monitor summary/coverage/activity/missions | READ MODEL | `VIEW_MONITOR`, scope antes de payload | MIGRATED |
| `manage-users` | ADMINISTRATION | Capability + target/inventory scope | MIGRATED |
| `role === ...` en componentes restantes | PRESENTACIÓN/ROUTING | No concede servidor | LEGACY COMPATIBILITY |

No queda un control **ROLE-ONLY** como autoridad en los consumidores CUT2-06
migrados. Los checks de rol restantes se mantienen como metadata de interfaz
o compatibilidad de módulos fuera del scope funcional de esta fase.
