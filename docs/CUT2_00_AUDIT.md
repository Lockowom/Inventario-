# CUT2-00 · Auditoría de entrada V2.3

Base auditada: `f9947c547c78a329385849bcd182558df9c7bcda` en
`feature/f16-live-monitor-consolidated`.

## Hallazgos confirmados

| Área | Estado actual | Decisión CUT2-01 |
| --- | --- | --- |
| C1 / `sync_counts` | C1 sigue siendo multiubicación; F16 sólo libera conciliación después del cierre global. | No se reemplaza ni se activa sealing rolling. |
| `create_cut` | Crea snapshots inmutables legacy con secuencia de exportación y lock por inventario. | Conserva `LEGACY_SNAPSHOT`; no se reinterpretan cortes existentes. |
| C2/C3 | F15/C2.2 usa misiones persistentes, subtareas y sets de serie. | No se cambia flujo, asignación ni contratos. |
| Conciliación | Casos, eventos y materialización están separados de los conteos físicos. | CUT2 añade sólo modelos de hallazgo/tolerancia para uso futuro. |
| RP | XLSX y artefactos existen en bucket privado; la cadena actual no tiene release sidecar V2.3. | Se agrega esquema append-only para release, audit y rectificación, sin generarlo aún. |
| Cierre | `close_inventory` existente cubre el ciclo legacy. | Se agrega el request/backup model sin sustituir el RPC actual. |
| RLS/capabilities | Roles y asignaciones existen; no había scope/validez/user type V2.3. | Se agregan columnas/tablas sin redireccionar los RPC legacy. |
| Offline/outbox | Persistencia y outbox continúan por plataforma y `sync_counts`. | No se cambia. |
| Inventory/master/system reference | Inventario y maestro están acotados por `inventory_id`; system reference ya es snapshot separado. | Se agrega bodega a inventario, con backfill local compatible. |

## Límites aplicados

- Sólo migración y pruebas locales CUT2-01.
- No hay cambios a UI, Edge Functions, artefactos reales, esquema QA remoto ni deploy.
- No se modifica Android, iOS ni Tauri/Windows.
- La bodega `LEGACY-QA` es el backfill local determinista para datos históricos.
- Las tablas nuevas tienen RLS y no exponen mutaciones directas a `authenticated`.

## Riesgo conocido de validación

La validación de PostgreSQL necesita Docker Desktop operativo. La migración y
la prueba pgtap están listas, pero el gate `READY_FOR_CUT2_LOCAL_DB` no puede
declararse hasta completar `supabase db reset` y `supabase test db --local`.
