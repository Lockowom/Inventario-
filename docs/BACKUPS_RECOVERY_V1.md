# Snapshots, respaldos y recuperación v1 — Contrato Fase 8

**Estado:** contrato F8A final para revisión. Ningún backup, Storage object, Edge Function, migración o restauración se implementa con este documento.

## Principios

- Los artefactos son evidencia privada, generada server-side y con hash SHA-256/tamaño almacenados.
- Nunca contienen `service_role`, claves, JWT, secretos ni un dump físico de PostgreSQL.
- Una recuperación verifica evidencia; jamás sobrescribe `count_records`, snapshots, cortes, rectificaciones o archivos oficiales existentes.
- No existe borrado operacional automático. La retención es indefinida hasta que una política de retención aprobada la sustituya mediante una migración y revisión explícita.

## Tipos y momentos de generación

| Tipo | Contenido y formato | Cuándo se reserva la solicitud | Quién genera / descarga |
|---|---|---|---|
| `SNAPSHOT` | JSON UTF-8 canónico versionado (`INVEN3_SNAPSHOT_V1`) de un corte: cabecera `inventory_cut`, `inventory_cut_items.snapshot` y metadata del `CUT_XLSX` (`file_name`, SHA-256, tamaño e identidad Storage). No incorpora rectificaciones posteriores. No es XLSX ni dump SQL. | Server-side al alcanzar `CUT → READY`; existe exactamente uno por `cut_id`. | ANALISTA asignado o ADMIN / mismo alcance |
| `TECHNICAL_BACKUP` | ZIP privado con `manifest.json`, `inventory.json`, `cuts.ndjson`, `cut-items.ndjson`, `rectifications.ndjson` y `artifacts.ndjson`; cada miembro se lista con SHA-256 y tamaño en el manifest. | Server-side tras `CUT → READY` (`CUT_READY_BACKUP`) y tras `INVENTORY → CONGELADO` (`FINAL_FROZEN_BACKUP`). | ADMIN / ADMIN |
| `RECTIFICATION_XLSX` | Workbook de auditoría definido en `RECTIFICACIONES_V1.md`. | Server-side después de crear una rectificación. | ANALISTA asignado o ADMIN / mismo alcance |

El `SNAPSHOT` representa exclusivamente la evidencia base del corte READY original. Por ello una rectificación nunca lo reemplaza ni se incorpora a su contenido: incluir rectificaciones existentes lo haría depender del instante de generación. Los JSON se serializan con claves y arrays ordenados de manera determinista y UTC ISO-8601. El ZIP conserva orden fijo de entradas y timestamps normalizados para permitir verificar contenido y hash de cada artefacto. `TECHNICAL_BACKUP` es un paquete lógico recuperable en ambiente aislado; no ejecuta SQL ni restaura directamente sobre una instancia viva.

Cada `TECHNICAL_BACKUP` incluye `as_of_at`, que fija la vista lógica reproducible: para `CUT_READY_BACKUP`, `source_cut_id = cut.id` y `as_of_at` es el instante server-side en que el corte alcanzó `READY`; para `FINAL_FROZEN_BACKUP`, `source_cut_id = null` y `as_of_at = inventory.frozen_at`. La generación física puede ocurrir después, pero un retry reconstruye el mismo conjunto lógico y no agrega cambios posteriores al `as_of_at`.

Al alcanzar `CUT → READY`, la misma operación server-side reserva transaccional e idempotentemente las solicitudes `SNAPSHOT` y `TECHNICAL_BACKUP/CUT_READY_BACKUP`. Al alcanzar `INVENTORY → CONGELADO`, reserva `TECHNICAL_BACKUP/FINAL_FROZEN_BACKUP`. Nunca se hace una llamada HTTP Edge dentro de esa transacción: la generación de bytes se ejecuta luego mediante Edge/retry controlado.

Cada reserva conserva su trazabilidad humana: `request_origin = SYSTEM`. Para un corte READY, `requested_by` es `generation_requested_by` del corte; para el backup de congelamiento, es el actor de `freeze_inventory`; para `RECTIFICATION_XLSX`, es `rectification.created_by`. Los reintentos manuales no alteran el actor canónico original. Las solicitudes explícitas de usuario, cuando una futura operación las permita, usan `request_origin = USER`.

## Bucket y descarga

Se reutiliza un bucket privado con rutas únicas y scope verificable. El cliente no carga, sobrescribe, borra ni lee objetos directamente. Edge usa credenciales de servicio sólo en runtime y entrega URLs firmadas de corta duración después de la autorización server-side.

Las rutas previstas separan evidencia y evitan colisión:

```text
inventory/<inventory-id>/cuts/<cut-id>/snapshots/<artifact-id>.json
inventory/<inventory-id>/cuts/<cut-id>/rectifications/<rectification-id>/<file-name>.xlsx
inventory/<inventory-id>/backups/<artifact-id>.zip
```

Todo objeto oficial tiene `storage_path` único, MIME, SHA-256, `size_bytes`, actor solicitante y UTC. El `CUT_XLSX` original conserva su ruta y bytes sin cambio.

## Lifecycle de artefactos

El lifecycle será común para snapshot, backup y rectificación. Debe vivir en una entidad de generación separada de `generated_files`: ésta representa el archivo oficial final y no debe reutilizarse como lock/transitorio.

```text
REQUESTED → FILE_GENERATED → VALIDATED → READY
REQUESTED / FILE_GENERATED / VALIDATED → ERROR
ERROR + objeto válido → RECOVER → FILE_GENERATED / VALIDATED → READY
ERROR + sin objeto → GENERATE
```

La fila de generación ya reserva identidad, request id, ruta y metadata de solicitud; `METADATA_CREATED` no es un estado separado. `RECOVER` es una acción, no un estado persistente. En `ERROR` se conserva mensaje seguro y evidencia disponible; no se borra ni reemplaza un objeto existente. `READY` es terminal e idempotente: la misma solicitud devuelve la misma metadata y no crea auditoría ni archivos nuevos.

## Recuperación controlada

Una recuperación de artefacto sólo puede:

1. autorizar al actor y bloquear la entidad de origen;
2. localizar metadata canónica y objeto privado;
3. descargar bytes server-side, recalcular SHA-256/tamaño y revalidar formato;
4. transicionar a `READY` si la evidencia coincide, o a `ERROR` si falta/corrompe;
5. registrar auditoría append-only.

La recuperación de `TECHNICAL_BACKUP` se realiza en entorno local/aislado: se verifica el manifest antes de abrir los miembros y se genera un informe de divergencias. No hay restauración automática, `db push`, SQL remoto, overwrite de Storage ni modificación de ERP/RP.

## Modelo, unicidad e idempotencia previstos, no implementados

`artifact_generations` contiene lifecycle transitorio y tendrá: UUID, `inventory_id`, `cut_id?`, `rectification_id?`, `artifact_type`, `scope`, `request_id`, `request_fingerprint`, `request_origin`, `requested_by`, `status`, `storage_path`, `sha256?`, `size_bytes?`, `generator_version?`, `as_of_at`, `error_safe?`, `created_at` y `updated_at`. Requerirá constraints para los pares de referencia y scope correctos.

`generated_files` contiene únicamente el artefacto oficial `READY`; no recibe una fila antes de validación exitosa. `VALIDATED → READY` inserta `generated_files` exactamente una vez y transiciona la generación de modo transaccional e idempotente.

La fuente canónica tiene como máximo un artefacto oficial: un `RECTIFICATION_XLSX` por `rectification_id`, un `SNAPSHOT` por `cut_id`, un `CUT_READY_BACKUP` por `source_cut_id` y un `FINAL_FROZEN_BACKUP` por inventario/evento de congelamiento. Recovery y retry no producen un segundo `generated_files`.

Para la generación, el mismo `request_id` sólo reutiliza la misma fila si el fingerprint conserva tipo, fuente, scope, `as_of_at` y actor. Cualquier diferencia devuelve `IDEMPOTENCY_CONFLICT`. Aun con un `request_id` nuevo, si el artefacto oficial único de la misma fuente/scope existe, se reutiliza su lifecycle/artefacto canónico y no se duplica `generated_files`.

Las funciones de generación y descarga exigirán `require_active_actor()` y `can_manage_inventory` para scope de analista, o `is_admin()` para `TECHNICAL_BACKUP`. Los helpers y funciones service-side se mantendrán en `app_private`/Edge con `search_path` fijado, grants mínimos, RLS y sin acceso de `anon`. CONTADOR no puede generar ni descargar estos artefactos.

## Auditoría F8 prevista

Además de `RECTIFICATION_CREATED`, el lifecycle usa eventos genéricos: `ARTIFACT_REQUESTED`, `ARTIFACT_FILE_GENERATED`, `ARTIFACT_VALIDATED`, `ARTIFACT_READY`, `ARTIFACT_ERROR` y `ARTIFACT_DOWNLOADED`. Su payload identifica `artifact_generation_id`, tipo, scope, corte, rectificación, `generated_file_id` cuando exista, SHA-256/tamaño cuando existan, `request_origin` y `requested_by`.

Una ejecución exitosa produce exactamente uno de `ARTIFACT_REQUESTED`, `ARTIFACT_FILE_GENERATED`, `ARTIFACT_VALIDATED` y `ARTIFACT_READY`. Retry de `READY`, `RECOVER` o lost ACK no duplica eventos ya completados. Un intento fallido real puede agregar un `ARTIFACT_ERROR`; la futura implementación incorpora `attempt_number` si es necesario para distinguir esos fallos legítimos de duplicados.

## Matriz F8 antes de CI pesada

| Grupo | Escenarios independientes acumulables |
|---|---|
| Unit | serialización canónica, manifest, nombres/rutas, hashes, ZIP determinista, normalización UTC |
| pgTAP | roles, asignación, estados, fingerprint/request id, unicidad oficial, transición, auditoría idempotente, RLS, grants y no hard delete |
| Edge/Storage | generación, validación, signed URL, SHA/size descargados, aislamiento de metadata |
| Recovery | ERROR sin objeto, ERROR con objeto, FILE_GENERATED recovery, VALIDATED recovery, storage missing y corrupt, READY idempotente |
| Security | CONTADOR/anon/no asignado denegados; upload/overwrite/delete directo no persiste; service role no llega al cliente |
| Concurrency | solicitudes simultáneas producen una sola generación/artefacto/auditoría por request id y numeración única por corte |
| Regression | F0–F7, 113 unit actuales, 208 pgTAP actuales, F4/F6, F7 Edge/Storage, 7 cortes, 2.350 filas, Android/iOS, advisors y audit productivo |

El harness F8 tendrá bootstrap fail-fast sólo para autenticación/fixtures base; el resto ejecutará de forma independiente e imprimirá `PASS <scenario>` o `FAIL <scenario>: <reason>` antes de retornar fallo agregado.
