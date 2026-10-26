# CUT2-10A — Auditoría de cierre final de inventario

Fecha: 2026-10-24. Alcance: diseño y auditoría local. Este documento no
introduce migraciones, RPCs, estados, capacidades ni cambios de interfaz.

## Resultado ejecutivo

El repositorio ya tiene un cierre **legacy** operativo: `public.close_inventory`
lleva `inventories.status` de `ABIERTO` a `CERRADO`, después de C1, sin casos
de conciliación abiertos y sin misiones de reconteo `QUEUED`/`ACTIVE`. Esa
autoridad fue correcta antes de CUT2, pero no reúne hechos que se volvieron
canónicos entre CUT2-03 y CUT2-09: sellos rolling, findings, evidencias
offline, UOM, huérfanos y releases RP. Por ello no es la autoridad apta para
un cierre final certificado.

CUT2-10B debe añadir una única lectura servidor-side de preparación de cierre
y hacer que el escritor de cierre la revalide bajo lock. No se debe inferir el
estado en cliente, ni reemplazar las fuentes de verdad existentes.

## Inventario de lifecycle actual

| Hito | Autoridad vigente | Evidencia | Estado para CUT2-10B |
| --- | --- | --- | --- |
| Borrador/preparación/apertura | `inventories.status`; `prepare_inventory`, `open_inventory` | `20260916133820_phase_1_initial_model_security.sql` | Se conserva. |
| C1 en curso | `inventories.status='ABIERTO'`, `count_records` y autorización vigente | `20261003230000_f16_c1_coverage_close.sql` | Se conserva. |
| C1 finalizado | `inventories.c1_completed_at`, `finalize_c1_coverage` | misma migración | Requisito obligatorio de cierre. |
| Conciliación final materializada | `reconciliation_cases`, `app_private.final_reconciliation_candidates` | misma migración | Requisito obligatorio: ningún caso no resuelto. |
| C2/C3 | `recount_missions` (`QUEUED`, `ACTIVE`, `COMPLETED`, `CANCELLED`) | CUT2-05/CUT2-07 | Requisito obligatorio: ninguna misión pendiente o activa. |
| Cierre legacy | `close_inventory` y `app_private.transition_inventory` | F16 C1 coverage close | Sigue disponible como compatibilidad; no se amplía ni se considera suficiente para cierre CUT2 final. |
| Congelación | `freeze_inventory` desde `CERRADO` | fase inicial | Post-cierre; no la reemplaza CUT2-10B. |

`get_inventory_lifecycle` expone hoy `can_close_inventory` usando sólo C1,
casos de conciliación y C2/C3. Es un read model de supervisión heredado; no
es un contrato de readiness CUT2-10 y no debe copiarse a cliente.

## Autoridades canónicas revisadas

| Dominio | Fuente de verdad existente | Bloquea reconciliación | Bloquea cierre final | Observación |
| --- | --- | ---: | ---: | --- |
| Lifecycle/C1 | `inventories`, `c1_completed_at`, `inventory_freeze_guards` | Sí | Sí | Falta C1 o hay sync pendiente: el snapshot final no es estable. |
| Reconciliación | `reconciliation_cases` + fingerprint de referencia del sistema | Sí | Sí | Sólo `RESUELTO` es terminal. |
| C2/C3 | `recount_missions` y eventos | Sí | Sí | `QUEUED` y `ACTIVE` bloquean; `COMPLETED`/`CANCELLED` no por sí solos. |
| Corte/sello | `rolling_cut_requests`, `inventory_sealed_references` | Según estado | Sí para solicitudes/identidades no estables | Sólo `SEALED` participa en RP; `SEALING`, `FAILED_SAFE`, `HELD`, `ORPHANED` requieren clasificación explícita. |
| Findings/evidence | `reference_findings`, `finding_evidence`, `reference_finding_events` | Según `blocks_recount_completion` | Sí con `blocks_close` y estado `OPEN`/`HELD` | CUT2-08 ya separa artefacto servidor de `REVIEW_REQUIRED` local. |
| Offline/outbox | `inventory_freeze_guards` y outbox cliente owner-bound | Sí si invalida C1 | Sí | Debe contar sólo hechos server-side pendientes/review, nunca cache del navegador. |
| UOM | `uom_resolution_cases` | Sí para identidad afectada | Sí si `OPEN`/`HELD` | CUT2-09 ya los bloquea para RP. |
| Huérfanos | `orphan_references` | Según policy | Sí si no están `RESOLVED` y afectan inventario | RP sólo usa `block_rp`; cierre debe informar el estado y no asumir que todo huérfano es inocuo. |
| Identidad/serial/partida/negativos | `inventory_sealed_references`, normalización `normalize_reference_key`, constraints, casos/finding | Sí si impide conciliación | Sí | No hay fallback de PARTIDA/SERIAL a SKU. Cantidad negativa no es válida en sello. |
| Rectificación/descartes | `rp_release_rectifications`, `rp_release_discards`, auditorías | No directamente | Sí si hay release supersedido, bloqueado o rectificación abierta | Historial es inmutable y debe reconciliarse antes del cierre. |
| RP | `app_private.rp_release_eligibility`, `rp_release_batches`, `rp_release_audits`, `rp_release_events` | No | Sí, conforme al contrato siguiente | CUT2-09 es local, no ERP. |

## Contrato RP que condiciona el cierre

`app_private.rp_release_eligibility` ya determina, por identidad sellada,
bloqueadores `NEGATIVE_QUANTITY`, finding de RP, C2/C3 abierta,
`UNRESOLVED_REVIEW`, huérfano y conflicto UOM. `preview_rp_release` genera un
fingerprint y `create_rp_release` persiste una selección inmutable en `DRAFT`.
`mark_rp_release_ready` produce el manifiesto/digest local `READY`; exportar
exige `READY`.

Política propuesta para CUT2-10B:

1. Toda referencia `SEALED` elegible debe aparecer exactamente una vez en una
   auditoría de release `READY` vigente de su inventario/bodega, o estar
   cubierta por un descarte/rectificación canónico y auditable.
2. Una referencia bloqueada para RP impide el cierre mientras su causa siga
   abierta; no se transforma en una omisión silenciosa del release.
3. Un `DRAFT` no es evidencia suficiente de preparación; bloquea cierre si
   contiene referencias del inventario. `BLOCKED` e `INTEGRITY_FAILURE`
   bloquean siempre. Un `SUPERSEDED` sólo deja de bloquear cuando su sucesor
   `READY` y su cadena de rectificación son íntegros.
4. Para el alcance CUT2-09, `READY` (manifiesto inmutable) es el requisito de
   release. No se añade requisito de XLSX binario para declarar close-ready:
   el contrato CUT2-09C permite `READY` por manifiesto local. CUT2-10B debe
   mostrar por separado la ausencia de archivo si una política posterior lo
   exige, sin reinterpretar `READY`.
5. Ningún paso del cierre genera exportación, release, ajuste ERP, XLSX ni
   cambio de stock.

La tabla actual `inventories` tiene una única `warehouse_id`; por tanto el
alcance implementable es inventario + su bodega canónica. Si el producto pasa
a representar un inventario multi-bodega, la preview debe agregar **todas**
las bodegas bajo ese inventario y requerir scope válido sobre todas; no debe
cerrar una selección parcial.

## Matriz global de bloqueadores propuesta

| Código estable propuesto | Fuente | Reconciliación | Cierre | RP | Severidad de salida |
| --- | --- | ---: | ---: | ---: | --- |
| `INVENTORY_NOT_OPEN` | `inventories.status` | Sí | Sí | — | Error |
| `C1_NOT_FINALIZED` | `c1_completed_at` | Sí | Sí | — | Error |
| `PENDING_SYNC_GUARD` | `inventory_freeze_guards` | Sí | Sí | — | Error |
| `OPEN_RECONCILIATION_CASE` | `reconciliation_cases` | Sí | Sí | — | Error |
| `OPEN_RECOUNT_MISSION` | `recount_missions` | Sí | Sí | — | Error |
| `UNSEALED_OR_UNSTABLE_REFERENCE` | rolling/sealed references | Sí | Sí | Sí | Error |
| `FINDING_BLOCKS_CLOSE` | findings `OPEN`/`HELD`, `blocks_close` | — | Sí | según flag | Error |
| `FINDING_BLOCKS_RP` | findings `OPEN`/`HELD`, `blocks_rp` | — | Sí | Sí | Error |
| `UNRESOLVED_OFFLINE_REVIEW` | finding/offline review provenance | Sí | Sí | Sí | Error |
| `UOM_CONFLICT` | `uom_resolution_cases` | Sí | Sí | Sí | Error |
| `ORPHAN_REFERENCE_OPEN` | `orphan_references` | Según policy | Sí | según `block_rp` | Error |
| `IDENTITY_OR_SERIAL_CONFLICT` | sealed identity + reconciliation/finding | Sí | Sí | Sí | Error |
| `RP_REFERENCE_OMITTED` | eligibility versus READY snapshots | — | Sí | Sí | Error |
| `RP_RELEASE_DRAFT` | `rp_release_batches` | — | Sí | — | Error |
| `RP_RELEASE_INTEGRITY_FAILURE` | release/audit/events | — | Sí | — | Error |
| `RECTIFICATION_CHAIN_OPEN` | release rectifications/discards | — | Sí | — | Error |
| `CLOSE_REQUEST_ACTIVE` | `inventory_close_requests` | — | Sí | — | Error |
| `RELEASE_EXPORT_NOT_PRESENT` | export metadata | — | Informativo | — | Warning |

Un código se emite con recursos afectados y conteo, nunca sólo como texto. La
previsualización puede mostrar todos los códigos; el escritor rechaza si hay
cualquiera con `blocks_close=true`.

## Brechas y decisiones de diseño para CUT2-10B

- No existe una autoridad única que materialice la conciliación final global.
  La fuente correcta ya existe, pero está repartida. La solución mínima es
  `app_private.inventory_close_readiness`, función estable de sólo lectura;
  no una tabla de resumen mutable.
- `inventory_close_requests` y `inventory_close_backups` existen desde
  CUT2-01, con RLS y validación de backup, pero no tienen escritor operativo.
  CUT2-10B puede utilizarlas para idempotencia/auditoría de la nueva ruta sin
  crear una familia paralela.
- `close_inventory` legacy no comprueba capability `CLOSE_INVENTORY`; usa
  `can_manage_inventory`. El reemplazo debe usar `require_inventory_capability`
  y seguir deny-by-default.
- La reconciliación final existe como candidatos/materialización C1. No debe
  introducirse una segunda reconciliación: readiness sólo valida que el
  materializado está resuelto y que no hay trabajo operativo pendiente.

## Consultas exploratorias locales (sólo lectura)

Estas consultas son el protocolo de auditoría/performance de CUT2-10B. Deben
ejecutarse contra Supabase local usando `EXPLAIN (ANALYZE, BUFFERS)`, sin DML:

```sql
-- Lifecycle y reconciliación base
SELECT status, c1_completed_at, closed_at, close_request_id
FROM public.inventories WHERE id = :inventory_id;

SELECT status, count(*) FROM public.reconciliation_cases
WHERE inventory_id = :inventory_id GROUP BY status;

SELECT round, status, count(*) FROM public.recount_missions
WHERE inventory_id = :inventory_id GROUP BY round, status;

-- La futura autoridad debe usar filtros selectivos sobre estos predicados.
EXPLAIN (ANALYZE, BUFFERS)
SELECT id FROM public.reference_findings
WHERE inventory_id = :inventory_id AND state IN ('OPEN','HELD')
  AND (blocks_close OR blocks_rp);

EXPLAIN (ANALYZE, BUFFERS)
SELECT id FROM public.inventory_sealed_references
WHERE inventory_id = :inventory_id AND state <> 'SEALED';

EXPLAIN (ANALYZE, BUFFERS)
SELECT id FROM public.rp_release_batches
WHERE inventory_id = :inventory_id
  AND state IN ('DRAFT','BLOCKED','INTEGRITY_FAILURE');
```

No se prescribe un índice nuevo: CUT2-10B debe medir con dataset local realista
y añadir uno sólo si el plan demuestra una ruta material no cubierta.

## Seguridad, concurrencia y post-cierre

El futuro escritor deberá: validar actor activo y `CLOSE_INVENTORY`; validar
scope de inventario y bodega; bloquear en orden `inventories →
inventory_close_requests idempotente → recursos de release/reconciliación que
determinen el fingerprint`; recomputar readiness dentro de la transacción; y
llamar una única transición auditada. El orden evita invertir los locks ya
empleados por CUT2-09 (`inventory → sealed references`).

La preview será `SECURITY DEFINER` con `search_path` fijo, objetos calificados,
sin `PUBLIC` execute y grant mínimo a `authenticated`; el cliente sólo ve el
resultado scoped. La mutación debe ser idempotente por `request_id`, no por un
flag de cliente. Tras `CERRADO`, la política conserva historial/auditoría,
bloquea nueva captura y cambios físicos; cualquier reapertura debe ser una
operación administrativa explícita, auditada y fuera de CUT2-10A.

## Guardas de regresión CUT2-09

Este bloque no modifica migraciones, RPCs, manifiestos, XLSX, harnesses R01–R10
ni interfaz RP. El control de diff de CUT2-10A debe limitarse a los dos
documentos `docs/CUT2_10_*`.

## Certificación B4 local

La implementación B materializa los códigos de la matriz mediante
`app_private.inventory_close_readiness`; no mantiene una tabla paralela ni una
autoridad de cliente. Las pruebas conductuales de CUT2-10 cubren las fuentes
de blocker disponibles en el modelo actual, el request replay y las escrituras
directas denegadas. Las pruebas de scope usan un inventario extranjero con la
misma bodega canónica: se deniega antes de devolver el payload de readiness,
por lo que no hay filtración de estado, referencias o releases.

La relación actual es uno a uno entre inventario y bodega. Por eso
``partial warehouse close`` no es un estado representable: cualquier cierre
usa la bodega del inventario y `require_inventory_capability` la comprueba
como parte de la misma autoridad. Una evolución multi-bodega requerirá un
contrato nuevo y pruebas propias; CUT2-10B no filtra una selección parcial.

La ejecución local con 1.500 referencias selladas arrojó 79,255 ms para la
autoridad de readiness, 13.508 shared-buffer hits y cero lecturas de disco.
El wrapper PL/pgSQL no expone planes internos por subconsulta; se conservaron
los índices existentes porque ninguna fuente concreta demostró una regresión o
un N+1 que justificara un índice adicional.
