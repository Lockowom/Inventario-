# C1 — Contexto operativo basado en inventario

Fecha: 2026-11-10
Alcance: C1 local y QA. No se modificó producción ni se eliminó información.

## Resultado

El flujo operativo vigente ya usa `inventory_id` como contexto de C1. No hay
tabla, RPC, contrato local ni componente de C1 que requiera `session_id`,
`count_session` o `counting_session`.

```
Login -> inventarios autorizados -> inventario ABIERTO -> C1 -> conteo C1
```

Un conteo se captura localmente con `inventoryId`, se envía por
`public.sync_counts(p_inventory_id, ...)` y se persiste en
`public.count_records.inventory_id`. `client_count_id` es la frontera de
idempotencia; no es una sesión.

## Mapa de impacto

| Área | Implementación vigente | Clasificación |
| --- | --- | --- |
| Inventario activo | `src/features/control-center/active-inventory-context.tsx` | Necesaria: selección explícita de un `inventory_id` ABIERTO. |
| Autorización C1 | `get_my_counting_authorization_snapshot(p_inventory_id)` y `resolve-counting-context.ts` | Necesaria: valida actor, capability, scopes y estado del inventario. No crea sesión de conteo. |
| C1 UI | `src/features/counting/counting-screen.tsx` | Necesaria: recibe un contexto `{ inventoryId, userId, inventoryStatus }`; no recibe `session_id`. |
| Lookup online | `c1_lookup_sku` y `c1_lookup_traceability` | Necesaria: consulta por `inventory_id + SKU`; no revela cantidades del sistema. |
| Registro | `save-physical-count.ts`, `supabase-sync-gateway.ts`, `public.sync_counts` | Necesaria: outbox y RPC usan `inventory_id`, `device_id` e idempotencia. |
| SQLite / IndexedDB | `local_count_records`, `DexieCountRepository`, `SqliteCountRepository` | Necesaria: el registro local contiene `inventory_id`, usuario, dispositivo y `client_count_id`; no contiene sesión. |
| Cache de autorización offline | `local_counting_context` | Necesaria como lease de autorización de actor + inventario. El nombre es histórico, pero no modela ni autoriza una sesión de conteo. |
| Maestro | `inventory_master_metadata`, `inventory_master_items` | Necesaria: la Carga Masiva prepara la matriz. C1 online consulta el SKU bajo demanda; no exige hidratar la matriz completa. |
| Referencia de sistema | `inventory_system_reference_metadata`, `inventory_system_reference_items` | Necesaria para conciliación y para sugerencias de partida/serie filtradas por inventario. No es requisito para abrir C1 de un SKU LEGACY. |
| C2 / C3 | `recount_missions`, `recount_mission_observations` | Necesaria: son tareas vinculadas a `inventory_id`, caso y corte; no dependen de una sesión C1. |
| Cortes | `inventory_cuts`, `rolling_cut_*` | Necesaria: seleccionan `count_records` por `inventory_id` y sus límites de corte; no dependen de una sesión. |

## Dependencias de sesión auditadas

La búsqueda de código operativo por `count_session`, `counting_session`,
`conteo_session`, `session_id`, `activeSession`, `selectedSession`,
"crear sesión", "restaurar sesión" y "sincronizar sesión" no devolvió
dependencias de conteo. Las coincidencias restantes son únicamente la sesión
de Supabase Auth o fixtures OTA, fuera del dominio C1.

- **A — necesaria:** sesión de Auth de Supabase para identificar al actor.
- **B — reemplazable:** comentarios antiguos que llamaban “session context” a
  la selección de inventario. Se normalizaron a “operational context”.
- **C — código muerto de sesión de conteo:** 0 rutas activas.

## Contrato operacional

1. La Carga Masiva inserta y valida maestro y referencias para el inventario.
2. Un actor autorizado selecciona un inventario `ABIERTO`.
3. C1 consulta el SKU directamente al backend usando `inventory_id + codigo`.
4. Para `PARTIDA` o `SERIAL`, C1 consulta sólo la trazabilidad del SKU.
5. La captura se guarda localmente y su outbox reintenta con el mismo
   `client_count_id`.
6. El backend valida actor activo, capability C1, inventory/warehouse scope,
   inventario ABIERTO, SKU, reglas de trazabilidad e idempotencia.

La referencia de sistema continúa siendo autoridad para conciliación, pero no
se expone a C1 como cantidad esperada, disponible o diferencia.

## Transición y deuda legacy

No se ejecutaron `DROP`, cambios destructivos ni migraciones de compatibilidad.
El artefacto `local_counting_context` se mantiene como cache de autorización
offline. No contiene ni reemplaza una sesión de conteo; puede renombrarse en
una migración futura sólo cuando exista un plan de migración de dispositivos.

## Pruebas relacionadas

- `tests/unit/save-physical-count.test.ts`: persiste `inventoryId`, crea
  `clientCountId` y verifica ausencia de `sessionId`.
- `tests/unit/counting-c1-readiness.test.tsx`: C1 directo, selector de
  inventario, lookup online y ausencia de prerrequisito de snapshot local.
- `tests/unit/counting-screen-2-0.test.tsx`: flujo de SKU / partida / serie.
- `tests/unit/supabase-c1-lookup-repository.test.ts`: contrato de lookup
  acotado y ciego.
