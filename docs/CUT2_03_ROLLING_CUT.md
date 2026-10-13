# CUT2-03 — rolling cut por referencia

## Alcance

`create_rolling_cut_v2(inventory_id, request_id, preview_fingerprint,
selection)` convierte una selección válida del preview CUT2-02 en un corte
atómico de referencias. No finaliza C1 global, no libera RP ni genera archivos.
`create_cut` mantiene su contrato histórico `LEGACY_SNAPSHOT` sin cambios.

## Flujo y estados

1. ADMIN o ANALISTA autorizado solicita el preview CUT2-02.
2. Envía las claves canónicas seleccionadas y su fingerprint.
3. La RPC bloquea sólo la fila del inventario, recalcula el preview y rechaza
   `PREVIEW_STALE` si cambió cualquier elemento material del fingerprint.
4. Inserta un `inventory_cuts` con modo `ROLLING_REFERENCE` y estado técnico
   `ROLLING_SEALED`, snapshots inmutables por registro C1 y sellos `SEALED`.
5. Una coincidencia queda como candidata de RP solamente; una diferencia crea
   caso y misión C2 ciega. No se crea release ni XLSX.

El estado `SEALING` existe en el modelo. La transacción SQL rápida no lo deja
persistido: si falla, PostgreSQL revierte todo; si confirma, cada referencia
queda directamente en `SEALED` con su snapshot y evento.

## Locks, carreras y offline

`sync_counts`, `correct_uncut_count` y el rolling cut bloquean la misma fila de
inventario. Por ello un conteo/corrección que gana el lock aparece en el
snapshot; si el corte gana, `sync_counts` devuelve `REJECTED /
REFERENCE_SEALED` sin insertar C1. El outbox conserva el registro local y puede
mostrar ese conflicto para tratamiento posterior como hallazgo post-corte.

Las claves se procesan ordenadas; no existe lock global entre inventarios. Las
referencias no seleccionadas continúan en C1. Un C2 creado por rolling cut se
puede reclamar mientras C1 global siga abierto; el gate F16 de C2 legacy no se
modifica.

## Idempotencia y auditoría

`rolling_cut_requests` fija `inventory_id + request_id`, fingerprint de preview
y root de selección. El mismo pedido devuelve el mismo corte. Cambiar preview o
selección bajo el mismo request responde `IDEMPOTENCY_CONFLICT`.

`rolling_cut_events` es append-only y registra `ROLLING_CUT_CREATED`,
`REFERENCE_SEALED` y `C2_CREATED_FROM_CUT`. Los snapshots se almacenan en
`rolling_cut_reference_snapshots`; casos y misiones incluyen `source_cut_id`.

## Seguridad

Las RPC son `SECURITY DEFINER` con `search_path` fijo, autenticación activa y
autorización servidor `can_manage_inventory`. No hay escrituras directas para
clientes sobre tablas CUT2-03; RLS sólo permite lectura de gestión. CONTADOR no
puede crear cortes, aunque puede reclamar una misión C2 autorizada.

## Límites conocidos / gate

CUT2-03 no implementa conversión de un conteo offline tardío a
`POST_CUT_FINDING`, C3 nuevo, release RP, XLSX, UI de confirmación ni recovery
asíncrono de sellos `ORPHANED`; deja el contexto necesario para esas fases.
La validación de volumen real y UI pertenece a QA posterior. CUT2-04 queda
fuera de este cambio.
