# Snapshots, respaldos y recuperación v1 — Contrato Fase 8

**Estado:** contrato propuesto para revisión F8A. Ningún backup, Storage object, Edge Function, migración o restauración se implementa con este documento.

## Principios

- Los artefactos son evidencia privada, generada server-side y con hash SHA-256/tamaño almacenados.
- Nunca contienen `service_role`, claves, JWT, secretos ni un dump físico de PostgreSQL.
- Una recuperación verifica evidencia; jamás sobrescribe `count_records`, snapshots, cortes, rectificaciones o archivos oficiales existentes.
- No existe borrado operacional automático. La retención es indefinida hasta que una política de retención aprobada la sustituya mediante una migración y revisión explícita.

## Tipos y momentos de generación

| Tipo | Contenido y formato | Cuándo se solicita | Quién genera / descarga |
|---|---|---|---|
| `SNAPSHOT` | JSON UTF-8 canónico versionado (`INVEN3_SNAPSHOT_V1`) de un corte: cabecera, `inventory_cut_items.snapshot`, cadena de rectificaciones existente y manifest de hashes. No es XLSX ni dump SQL. | Después de que un corte queda `READY`; una rectificación no reemplaza el snapshot original. | ANALISTA asignado o ADMIN / mismo alcance |
| `TECHNICAL_BACKUP` | ZIP privado con `manifest.json`, `inventory.json`, `cuts.ndjson`, `cut-items.ndjson`, `rectifications.ndjson` y `artifacts.ndjson`; cada miembro se lista con SHA-256 y tamaño en el manifest. | Tras cada corte `READY` y un respaldo final al congelar. | ADMIN / ADMIN |
| `RECTIFICATION_XLSX` | Workbook de auditoría definido en `RECTIFICACIONES_V1.md`. | Después de crear una rectificación. | ANALISTA asignado o ADMIN / mismo alcance |

Los JSON se serializan con claves y arrays ordenados de manera determinista y UTC ISO-8601. El ZIP conserva orden fijo de entradas y timestamps normalizados para permitir verificar contenido y hash de cada artefacto. `TECHNICAL_BACKUP` es un paquete lógico recuperable en ambiente aislado; no ejecuta SQL ni restaura directamente sobre una instancia viva.

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
REQUESTED
  → METADATA_CREATED
  → FILE_GENERATED
  → VALIDATED
  → READY

FILE_GENERATED / VALIDATED
  → RECOVER → validar bytes existentes → READY

REQUESTED / METADATA_CREATED / FILE_GENERATED / VALIDATED
  → ERROR
ERROR
  → RECOVER o nueva solicitud idempotente
```

`METADATA_CREATED` reserva identidad, request id y ruta, pero no declara artefacto oficial hasta que hash, tamaño y validación estén presentes. En `ERROR` se conserva mensaje seguro y evidencia disponible; no se borra ni reemplaza un objeto existente. `READY` es terminal e idempotente: la misma solicitud devuelve la misma metadata y no crea auditoría ni archivos nuevos.

## Recuperación controlada

Una recuperación de artefacto sólo puede:

1. autorizar al actor y bloquear la entidad de origen;
2. localizar metadata canónica y objeto privado;
3. descargar bytes server-side, recalcular SHA-256/tamaño y revalidar formato;
4. transicionar a `READY` si la evidencia coincide, o a `ERROR` si falta/corrompe;
5. registrar auditoría append-only.

La recuperación de `TECHNICAL_BACKUP` se realiza en entorno local/aislado: se verifica el manifest antes de abrir los miembros y se genera un informe de divergencias. No hay restauración automática, `db push`, SQL remoto, overwrite de Storage ni modificación de ERP/RP.

## Modelo y controles previstos, no implementados

La futura entidad `artifact_generations` tendrá UUID, `inventory_id`, referencias compuestas opcionales a corte/rectificación, tipo, scope, request id, estado, error seguro, actor solicitante y timestamps UTC. Requerirá constraints que obliguen los pares correctos de referencia según tipo y unicidad de solicitud. `generated_files` conservará sólo metadata de artefacto oficial listo, con sus FKs actuales.

Las funciones de generación y descarga exigirán `require_active_actor()` y `can_manage_inventory` para scope de analista, o `is_admin()` para `TECHNICAL_BACKUP`. Los helpers y funciones service-side se mantendrán en `app_private`/Edge con `search_path` fijado, grants mínimos, RLS y sin acceso de `anon`. CONTADOR no puede generar ni descargar estos artefactos.

## Matriz F8 antes de CI pesada

| Grupo | Escenarios independientes acumulables |
|---|---|
| Unit | serialización canónica, manifest, nombres/rutas, hashes, ZIP determinista, normalización UTC |
| pgTAP | roles, asignación, estados, request id, unicidad, transición, RLS, grants y no hard delete |
| Edge/Storage | generación, validación, signed URL, SHA/size descargados, aislamiento de metadata |
| Recovery | ERROR sin objeto, ERROR con objeto, FILE_GENERATED recovery, VALIDATED recovery, storage missing y corrupt, READY idempotente |
| Security | CONTADOR/anon/no asignado denegados; upload/overwrite/delete directo no persiste; service role no llega al cliente |
| Concurrency | solicitudes simultáneas producen una sola generación/artefacto/auditoría por request id y numeración única por corte |
| Regression | F0–F7, 113 unit actuales, 208 pgTAP actuales, F4/F6, F7 Edge/Storage, 7 cortes, 2.350 filas, Android/iOS, advisors y audit productivo |

El harness F8 tendrá bootstrap fail-fast sólo para autenticación/fixtures base; el resto ejecutará de forma independiente e imprimirá `PASS <scenario>` o `FAIL <scenario>: <reason>` antes de retornar fallo agregado.
