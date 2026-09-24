# Rectificaciones post-corte v1 — Contrato Fase 8

**Estado:** contrato F8A final para revisión. No habilita todavía migraciones, RPC, Edge Functions ni UI.

## Alcance e invariantes

Una rectificación es evidencia nueva y separada del conteo que fue congelado en un corte. Conserva una cadena auditable, pero nunca cambia la evidencia anterior:

```text
count_records cortado                 inmutable
inventory_cut_items.snapshot          inmutable
CUT_XLSX                              inmutable
generated_files(CUT_XLSX)             sin overwrite ni delete
```

La fuente inicial de una rectificación es el `snapshot` de `inventory_cut_items`, nunca una reconstrucción desde `count_records`. El archivo RP original continúa exactamente como fue certificado en Fase 7. Una rectificación tampoco reabre captura ni libera `cut_id`/`export_seq`.

## Estados de inventario y autorización

Se permite rectificar un corte en `ABIERTO`, `CERRADO` y `CONGELADO`; está prohibido en `BORRADOR` y `PREPARADO`. La regla es válida porque una rectificación crea evidencia append-only separada de un corte existente e inmutable. Incluso en `CONGELADO`, no reabre captura, no modifica `count_records` ni `inventory_cut_items.snapshot`, no libera `cut_id`/`export_seq`, y no modifica el `CUT_XLSX` original.

| Actor | Crear / reintentar | Consultar / descargar |
|---|---|---|
| CONTADOR | No | No |
| ANALISTA | Sólo con asignación activa y `can_manage_inventory` | Sólo en inventario asignado |
| ADMIN | Sí | Sí |

La autorización ocurre dentro de PostgreSQL/Edge; ocultar controles en UI no es una autorización. El rol proviene de `profiles`, nunca de metadata editable del cliente.

## Propuesta de `rectify_cut`

La futura RPC pública será `public.rectify_cut(p_cut_id uuid, p_count_record_id uuid, p_physical_payload jsonb, p_reason text, p_request_id uuid)` y será `SECURITY DEFINER` sólo con `search_path` fijado, `require_active_actor()` y permisos explícitos para `authenticated`.

La ejecución será una única transacción:

```text
autorizar actor
→ bloquear inventario y corte
→ comprobar estado permitido y pertenencia de count_record al corte
→ comprobar inventory_cut_items.snapshot
→ resolver old_values efectivo
→ validar p_physical_payload contra maestro congelado
→ asignar rectification_number bajo el mismo bloqueo
→ insertar cut_rectifications
→ insertar RECTIFICATION_CREATED append-only
→ commit
```

`p_request_id` es UUID obligatorio. El esquema previsto añade `request_id` a `cut_rectifications` con `UNIQUE (cut_id, request_id)` y exige comparar el fingerprint canónico de la solicitud:

```text
request_fingerprint = SHA-256(
  cut_id + count_record_id + actor_user_id
  + canonical_physical_payload + normalized_reason
)
```

La serialización de `canonical_physical_payload` ordena determinísticamente sus claves y `normalized_reason` aplica la normalización aprobada antes de calcular el hash. La implementación podrá materializar ese hash o recomponerlo desde datos persistidos, pero siempre deberá compararlo.

El mismo `(cut_id, request_id)` sólo es idempotente si conserva exactamente actor, `count_record_id`, payload físico canónico y motivo normalizado: devuelve la misma rectificación y no agrega fila, número, auditoría ni solicitud de artefacto. Si cualquiera difiere —incluido el actor— devuelve `IDEMPOTENCY_CONFLICT`; nunca devuelve silenciosamente una rectificación anterior. Un `request_id` nuevo puede crear una nueva decisión auditada.

La numeración se calcula sólo después de bloquear el mismo corte/inventario. Bajo ese bloqueo puede usarse `coalesce(max(rectification_number), 0) + 1` de forma serializada, respaldada por el `UNIQUE (cut_id, rectification_number)` existente. Nunca se hará `SELECT MAX + 1` sin bloqueo.

## Cadena de valores

`old_values` y `new_values` son proyecciones físicas canónicas, no payloads libres. Contienen `ubicacion`, `codigo`, `serie`, `partida`, `pieza_producto`, `fecha_vencimiento`, `talla`, `color`, `cantidad_contada` y `descripcion` derivada. El `count_record_id`, corte, actor, motivo, número y UTC viven en columnas o auditoría, no se aceptan desde el cliente.

```text
registro A: snapshot original → R001 ───────────────→ R003
                            old=snapshot             old=R001.new_values
registro B: snapshot original ───────────→ R002
                                         old=snapshot
```

Para el mismo `(cut_id, count_record_id)`, la primera fila toma `old_values` del `inventory_cut_items.snapshot`. Cada fila posterior toma exactamente `new_values` de la rectificación previa de ese registro, ordenada por `rectification_number DESC` bajo el bloqueo. Ninguna versión histórica se actualiza o elimina.

`rectification_number` es global por corte: si A es `R001`, B es `R002` y A vuelve a rectificarse, ésta es `R003`, cuyo `old_values` es `R001.new_values`, nunca `R002.new_values`.

## Validación física y descripción

El servidor normaliza y valida el nuevo payload con el mismo contrato de captura/corrección pre-corte:

- `ubicacion` cumple `^(A|B|C|C2|D|F|G|H|I)-[0-9]{2}-[0-9]{2}$`;
- `codigo` se conserva como texto mayúsculo y debe existir en el maestro congelado del mismo inventario;
- SKU `SERIAL`: serie obligatoria, máximo 19 caracteres, partida ausente y cantidad exactamente 1;
- SKU `PARTIDA`: partida obligatoria; los valores textuales preservan ceros iniciales;
- cantidad es entero positivo; fecha es ISO `YYYY-MM-DD` válida o nula; el resto de textos conserva su semántica actual;
- `p_physical_payload` acepta exclusivamente `ubicacion`, `codigo`, `serie`, `partida`, `pieza_producto`, `fecha_vencimiento`, `talla`, `color` y `cantidad_contada`; se rechaza cualquier clave inesperada;
- no acepta `descripcion`, actor, timestamps, identificadores de corte/conteo, `rectification_number` ni `request_id`; `descripcion` se deriva server-side desde el maestro autorizado para el `codigo` final.

El servicio rechaza referencias cruzadas entre inventarios y conteos no pertenecientes al corte. La corrección no modifica `count_records`, el maestro, el snapshot ni el XLSX original.

## Auditoría

La misma transacción agrega exactamente un evento `RECTIFICATION_CREATED` con:

```text
inventory_id, cut_id, rectification_id, count_record_id,
rectification_number, actor_user_id, reason, request_id
```

El payload registra hashes canónicos de `old_values` y `new_values`; los identificadores, SHA-256, tamaño y ruta de `RECTIFICATION_XLSX` se agregarán cuando el artefacto alcance `READY`. La auditoría es append-only y un retry idempotente no duplica eventos.

## Propuesta `RECTIFICATION_XLSX`

Es un **archivo de auditoría**, no un archivo importable en RP y no altera el contrato de nueve columnas del `CUT_XLSX` de Fase 7.

Nombre estable:

```text
INVEN3_<INVENTARIO_CANONICO>_CORTE_004_RECTIFICACION_001.xlsx
```

`<INVENTARIO_CANONICO>` usa el mismo token estable ya utilizado por Fase 7 (UUID sin guiones en mayúsculas); no usa un nombre editable.

El workbook contiene dos hojas y no usa fórmulas:

1. `RECTIFICACION`: pares `CAMPO`/`VALOR` para inventario, corte, rectificación, `count_record_id`, actor, `created_at` UTC, motivo, request id y hashes de valores.
2. `VALORES`: dos filas, `ANTERIOR` y `CORRECTO`, con columnas `VERSION`, `UBICACION`, `CODIGO`, `SERIE`, `PARTIDA`, `PIEZA DEL PRODUCTO`, `FECHA DE VENCIMIENTO`, `Talla del producto`, `Color del Producto`, `Cantidad Contada`, `DESCRIPCION`.

Identificadores se escriben como texto, fechas como celdas XLSX `dd-mm-yyyy` o blancas reales, y cantidad como entero positivo. La validación futura reabre el archivo y verifica hojas, columnas, tipos, ausencia de fórmulas, ceros iniciales, fecha, SHA-256 y `size_bytes` antes de `READY`.

## Cambios de base previstos, no implementados

- Agregar `cut_rectifications.request_id`, `request_fingerprint` o una comparación persistible equivalente, y su unicidad por corte para la idempotencia estricta.
- Agregar una entidad de lifecycle de artefacto, referenciada por inventario/corte/rectificación con FKs compuestas, para no sobrecargar `generated_files` —que conserva metadata oficial inmutable— con estados transitorios.
- Mantener `cut_rectifications`, `generated_files`, `audit_events`, `inventory_cuts`, `inventory_cut_items` y `count_records` sin cambio destructivo ni hard delete.
- Revocar toda escritura directa desde cliente; sólo RPC/Edge service-side crean rectificaciones y artefactos.

## Matriz de aceptación propuesta

| Capa | Casos obligatorios |
|---|---|
| Unit | normalización, rechazo de claves inesperadas, cadena R001/R002/R003 entre registros, serial/partida, fecha, ceros, descripción derivada, fingerprint e idempotencia/conflicto |
| pgTAP | roles, asignación, estados `ABIERTO/CERRADO/CONGELADO`, FKs compuestas, numeración concurrente, append-only, grants/RLS |
| Edge/Storage | artifact separado, hash/tamaño, signed download, rechazo de overwrite/delete directo |
| Recovery | request, metadata, generated, validated, READY, ERROR, recover, objeto faltante/corrupto |
| Regression | F0–F7, 7 cortes, 2.350 filas, CUT_XLSX y READY originales sin cambios |
