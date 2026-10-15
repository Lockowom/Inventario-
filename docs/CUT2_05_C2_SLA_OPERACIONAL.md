# CUT2-05 — C2 por corte y SLA operacional

## Resultado local

C2 sigue siendo una única misión ciega por referencia de conciliación. CUT2-05 añade control de ejecución; no cambia cantidades C1, reglas de conciliación, contratos de Supabase existentes ni la excepción post-sello de CUT2-04.

Cada C2 nacida de un rolling cut termina vinculada con:

- `source_cut_id`;
- `source_sealed_reference_id`;
- el calendario operativo de su bodega;
- `claim_due_at` y `c2_due_at` inmutables;
- historial append-only de su ciclo de vida.

El vínculo con la referencia sellada se completa desde el evento inmutable `C2_CREATED_FROM_CUT`; el índice parcial garantiza que una referencia sellada no genere dos C2.

## Estados operacionales

La tabla mantiene los estados F15 compatibles (`QUEUED`, `ACTIVE`, `COMPLETED`, `CANCELLED`). La proyección CUT2-05 descompone `ACTIVE` en:

| Proyección | Persistencia | Significado |
| --- | --- | --- |
| `QUEUED` | `status=QUEUED` | Espera un contador elegible. |
| `CLAIMED` | `status=ACTIVE`, `started_at IS NULL` | Fue reclamada, aún sin evidencia física. |
| `ACTIVE` | `status=ACTIVE`, `started_at IS NOT NULL` | Ya registró evidencia o inició una subtarea. |
| `C2_OVERDUE_OPERATIONAL` | `overdue_at` o fecha SLA vencida | Incumplimiento operativo visible en Monitor. |

`started_at` se materializa al primer cambio de subtarea o evidencia C2. Esta distinción impide entregar a otro contador cantidades o series ya vistas.

## SLA por horas operativas

`recount_sla_policies` se configura por bodega. El valor inicial local es:

- reclamo: 60 minutos operativos;
- resolución C2: 240 minutos operativos;
- máximo de reasignaciones: 3.

`operational_deadline_after` reutiliza calendario, zona horaria, turnos, descansos, feriados y DST de CUT2-01. No usa un contador de reloj corrido. Un calendario sin capacidad suficiente falla de manera segura, en vez de crear una fecha ficticia.

## Claim, abandono y reasignación

`claim_next_recount_mission` conserva todos los filtros previos: rol, autorización, capacidad C2, inventario abierto, C1-separación y `FOR UPDATE SKIP LOCKED`. Además, una misión liberada no puede ser reclamada nuevamente por su último operador.

Un contador puede usar **LIBERAR SIN EVIDENCIA** sólo antes de iniciar trabajo. ADMIN/ANALISTA puede usar **REASIGNAR** en Monitor bajo la misma condición. La reasignación no nombra un usuario: devuelve la misión a la cola; el siguiente claim vuelve a comprobar independencia C1 y permisos.

Si ya existe evidencia, la reasignación se rechaza explícitamente. El caso debe escalarse, preservando la ceguera y trazabilidad en vez de mostrar el progreso del primer contador a otro usuario.

`process_recount_sla` es la acción autorizada del Monitor:

1. registra una sola vez `C2_OVERDUE_OPERATIONAL`;
2. reencola automáticamente sólo una misión expirada sin evidencia;
3. conserva una misión iniciada como vencida/escalable, sin borrar ni transferir evidencia;
4. respeta el límite de reasignaciones.

## Offline y CUT2-04

Las operaciones C2.0 existentes permanecen en `recountOfflineOutbox` y se reproducen por las mismas RPC guardadas cuando vuelve la conectividad. No se agregó una ruta de escritura directa. Un timeout o una liberación no se puede poner offline, porque cambiar propiedad de una misión requiere el lock del servidor.

CUT2-04 no cambia: un C1 tardío de referencia sellada sigue siendo finding idempotente y `REVIEW_REQUIRED`; un C2 activo continúa siendo la única vía física permitida después del sello.

## Monitor

ADMIN/ANALISTA ve `claimed_missions`, `active_missions`, `overdue_operational` y `reassignment_pending`. Antes de leer el dashboard, el Monitor ejecuta el procesador de SLA autorizado. La proyección `get_c2_operational_missions` informa si una misión es realmente reasignable considerando subtareas y observaciones, por lo que la UI no decide seguridad.

## Pruebas locales

- `cut2_05_c2_sla_contract_test.sql`: 39 pruebas de esquema, privilegios, calendario, claim, liberación, reasignación, timeout e idempotencia.
- `cut2_03_rolling_cut_test.sql`: añade la evidencia de vínculo C2 → referencia sellada.
- `npm run test:cut2-05:concurrency`: dos sesiones PostgreSQL reales; una reclama, la otra recibe `NULL` por `SKIP LOCKED`, y queda exactamente una misión activa.
- `tests/unit/recount-queue-screen.test.tsx` y `tests/unit/recount-offline-outbox.test.ts`: UI C2 y outbox offline.
- La suite Chromium corrige la deuda `VITE_PLAYWRIGHT_FIXTURE_TIMEOUT`: ejecuta en un puerto aislado y la fixture espera el contrato renderizado, no un evento de carga bloqueable por el primer arranque de Vite.

No se realizó migración remota, push, despliegue, OTA, cambio de producción, iOS ni Windows/Tauri.

## Certificación local de cierre

- `npx supabase test db --local supabase/tests`: 37 archivos, 658 pruebas, PASS.
- `npm run test:cut2-05:concurrency`: PASS. Dos sesiones PostgreSQL reales dejaron una sola C2 activa; la segunda recibió `NULL` por `SKIP LOCKED`.
- `EXPLAIN (ANALYZE, BUFFERS)`: la cola C2 usa `recount_missions_c2_sla_queue_idx` (`Index Only Scan`, 0.198 ms en la fixture local).
- `npm test -- --run`: 79 archivos, 453 pruebas, PASS.
- `npm run typecheck`, `npm run lint` y `npm run build`: PASS.
- `npm run test:e2e`: 40 Chromium E2E, PASS.
- Supabase Security Advisor local: sin hallazgos. El DB linter conserva sólo advertencias preexistentes fuera de CUT2-05 (`canonical_rectification_payload`, `request_cut_file_generation`, `get_inventory_lifecycle`).
