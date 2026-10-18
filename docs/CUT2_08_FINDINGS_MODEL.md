# CUT2-08 — Modelo operativo de findings

## Fuente única

`public.reference_findings` es la única familia canónica. `recount_subtask_findings`
continúa sólo como entrada compatible de C2/C3 y el trigger la proyecta una vez hacia
el finding canónico. `REVIEW_REQUIRED` es estado local de outbox, nunca un estado
de finding servidor.

## Contrato

Un finding conserva la identidad CUT2 (inventario, bodega, tipo de referencia y clave
normalizada), reporter, fuente, severidad, gates, evidencia y resolución. La evidencia
vive en `finding_evidence`, es append-only y puede contener una referencia Storage/hash,
pero no binarios. `reference_finding_events` registra reporte, evidencia, asignación,
enlace al sello, resolución y reapertura.

Los únicos cierres operacionales son `resolve_reference_finding` o el wrapper
pre-sello compatible. Ambos requieren actor activo, scope, capability y código de
resolución tipado; `RESOLVED` sin código, actor y fecha viola constraints.

## Gates

- HIGH/CRITICAL pre-sello bloquean sello.
- CRITICAL originado en una misión bloquea completar esa misión C2/C3.
- HIGH/CRITICAL, y `AUTHORIZATION_REVOKED_OFFLINE`, bloquean elegibilidad RP.
- CRITICAL y revocación offline bloquean cierre.
- Resolver no ajusta stock, no publica RP y no cierra inventario.

## Seguridad y visibilidad

Las RPC públicas usan `SECURITY DEFINER` con search path vacío, revocan PUBLIC y
revalidan actor/capability/scope. El Monitor se alimenta de
`get_live_monitor_findings`; la consulta se filtra servidor-side por inventario/bodega
antes de devolver filas o contadores de evidencia. No incluye cantidades esperadas,
Disponible ni resultados previos para el contador C2/C3.

## Concurrencia e idempotencia

`source_event_key` es único: un reintento de la misma evidencia no puede crear dos
findings. Resolver bloquea la fila; el primer resolvedor gana y el segundo recibe la
misma resolución idempotente. El bridge C2/C3 usa el id del finding de subtarea como
source key. La evidencia se agrega, nunca se sobreescribe.

### Evidencia posterior a resolución

CUT2-08J adopta **Policy A: reapertura controlada**. Una evidencia no crítica puede
adjuntarse a un finding `RESOLVED` y conserva su estado terminal. Una evidencia con
`metadata.critical=true` abre nuevamente el mismo finding, eleva su severidad a
`CRITICAL`, vuelve a derivar sus blockers y escribe exactamente un evento `REOPENED`.
No sobrescribe `resolved_by`, `resolved_at` ni `resolution_code`: esos campos siguen
siendo la decisión histórica hasta que un actor autorizado tome una nueva decisión
tipada.

`finding_evidence.source_event_id`, único por finding cuando está presente, hace que
los reintentos de un evento offline devuelvan la evidencia original y no dupliquen
evidencia, reapertura ni auditoría. La RPC bloquea la fila de finding antes de revisar
esa clave; por tanto `resolve ↔ evidence` se serializa sin perder información ni crear
estados terminales contradictorios.

## C1 offline y post-sello

`report_c1_reference_finding` es la única entrada para un hallazgo físico C1
capturado por el cliente. Deriva en servidor la identidad normalizada desde
`codigo` y referencia, exige actor activo y `FINDING_REPORT` scoped, y usa
`source_event_key` como clave de idempotencia. El mismo evento no puede crear
un segundo finding, evidencia ni evento `REPORTED`.

La cola local C1 está versionada y separada por `actor_id`; conserva el evento,
identidad y `captured_at` a través de reinicio. El servidor vuelve a autorizar al
flush. Una denegación de autorización o de asignación es `REVIEW_REQUIRED`
terminal local, sin reintento infinito. Si la referencia se selló mientras el
hallazgo estaba offline, el artefacto canónico queda enlazado al sello con
`OFFLINE_LATE_COUNT`; no reabre C1 ni modifica el snapshot.

`sync_offline_c1_reference_finding` hace explícito el resultado post-sello al
cliente: devuelve `REVIEW_REQUIRED / REFERENCE_SEALED` tras preservar el
finding y la evidencia canónicos. Si la autorización actual fue revocada, el
cliente intenta primero esa mutación normal (que se deniega) y luego llama al
límite mínimo `preserve_revoked_offline_c1_finding`. Este último exige actor
activo, una asignación presente o histórica del mismo inventario y ausencia de
la capability actual `FINDING_REPORT`; crea exactamente un finding
`AUTHORIZATION_REVOKED_OFFLINE` de revisión, nunca un C1 autorizado. Conserva
actor, `captured_at`, identidad y `source_event_key`, y es idempotente por esa
clave. Ambas razones son terminales en el outbox ligado al actor; sólo un error
de transporte permanece reintentable.

El detalle scoped deriva `review_context` desde datos del servidor:
`OFFLINE_LATE_COUNT → REFERENCE_SEALED` y
`AUTHORIZATION_REVOKED_OFFLINE → AUTHORIZATION_REVOKED`. Un revisor con
`VIEW_MONITOR` scoped ve evidencia, timeline y enlace a la referencia sellada
sin depender del dispositivo que capturó el evento.

## Operación en Monitor

`get_reference_finding_detail` devuelve una proyección scoped (detalle,
evidencia inmutable y timeline) sólo tras validar `VIEW_MONITOR` sobre el
inventario y bodega del finding. `get_my_reference_finding_actions` deriva las
acciones de las capabilities efectivas, nunca de metadata `role`.

Los candidatos se obtienen exclusivamente con
`list_reference_finding_assignees`: exige `FINDING_ASSIGN`, valida el scope del
finding y devuelve sólo usuarios activos que pueden resolver ese finding. Así la
UI usa nombres legibles sin enumerar perfiles ni inferir autorización. La RPC de
asignación, evidencia y resolución tipada revalida todo en servidor.

### UI operativa CUT2-08J4

La lista de hallazgos usa exclusivamente el read-model de Monitor, que ya
llega limitado por inventario y bodega en el servidor. Los filtros de estado,
severidad y asignación son sólo una reducción visual de esas filas autorizadas:
nunca construyen permisos ni recuperan datos de otra bodega.

El detalle devuelve etiquetas de inventario, bodega y usuarios, además de la
cadena C2/C3/corte cuando existe, dentro de la misma comprobación VIEW_MONITOR
scoped. No devuelve Disponible, cantidades esperadas, diferencias ni resultados
previos. La vista renderiza únicamente la nota de evidencia y los eventos
auditados, no payloads crudos que puedan ser un canal lateral.

Las acciones de detalle son formularios, no prompts: evidencia es append-only;
la resolución exige una opción del catálogo tipado y una nota no vacía antes de
invocar el RPC. El servidor conserva la validación de enum, actor, scope y
estado como frontera definitiva. Tras una evidencia crítica posterior, la
resolución histórica se mantiene visible y el timeline registra REOPENED.
