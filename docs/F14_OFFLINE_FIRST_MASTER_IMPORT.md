# F14 — Maestro offline-first e importación inteligente

## Objetivo

Eliminar el bloqueo de reimportación del Maestro SKU sin degradar la trazabilidad de INVEN3 y acercar la experiencia de carga al flujo operativo de CCO.

## Diagnóstico

El conteo de INVEN3 ya es offline-first:

- Maestro durable en SQLite móvil y Dexie/IndexedDB web.
- Conteos persistidos localmente antes de usar red.
- Outbox durable con replay idempotente.
- Contexto autorizado server-verified que puede continuar offline.
- Sincronización single-flight por usuario + inventario.

El bloqueo observado estaba en la preparación del Maestro. La RPC histórica `import_inventory_master` eliminaba todo `inventory_master_items` y luego reinsertaba el nuevo snapshot. Esa estrategia choca con claves foráneas `ON DELETE RESTRICT`, especialmente:

- `inventory_master_exceptions.master_item_id`;
- `count_records (inventory_id, codigo)`.

Por eso un archivo podía validarse correctamente en frontend y fallar recién al confirmar.

## F14

### 1. Pegar desde Excel / Google Sheets

`Maestro SKU` acepta texto tabulado directamente desde el portapapeles.

Formatos admitidos:

- TSV de Excel/Sheets con encabezados;
- TSV de dos columnas sin encabezados;
- CSV;
- TXT/TSV;
- XLSX.

Encabezados reconocidos:

- `CODIGO`, `COD. PRODUCTO`, `COD PRODUCTO`;
- `DESCRIPCION`, `PRODUCTO`.

En XLSX se prioriza la hoja `STOCK TOTAL` cuando existe.

Los códigos duplicados continúan siendo bloqueantes. INVEN3 no aplica la regla “última fila gana” de CCO para el Maestro, porque el Maestro es un snapshot de autoridad y una ambigüedad de SKU debe resolverse antes de persistir.

### 2. Smart merge atómico

La nueva RPC mantiene la misma firma pública, pero cambia su semántica interna:

1. valida rol ADMIN, estado BORRADOR/PREPARADO y payload;
2. normaliza Código + Descripción;
3. conserva el `id` de todo SKU que sigue existiendo;
4. actualiza descripción, tipo de control y origen mediante `ON CONFLICT ... DO UPDATE`;
5. inserta SKU nuevos;
6. retira autorizaciones de excepción anteriores;
7. elimina SKU que ya no pertenecen al snapshot cuando no tienen conteos históricos;
8. recalcula metadata + fingerprint;
9. audita el resultado como `SMART_MERGE_V1`.

Si un SKU que debería retirarse tiene `count_records`, la operación falla completa y entrega el código concreto. No se hace importación parcial.

### 3. Historial de excepciones

Las excepciones ya no necesitan desaparecer para permitir un nuevo baseline.

Se añade:

- `active`;
- `retired_at`;
- `retired_by`;
- `retired_reason`;
- `retired_import_identifier`.

La relación histórica con `inventory_master_items` pasa a `ON DELETE SET NULL`.

La unicidad cambia a una restricción parcial: sólo puede existir una autorización activa por `inventory_id + codigo`. Esto permite conservar múltiples autorizaciones históricas y exigir una nueva aprobación si el SKU vuelve a faltar en un baseline posterior.

### 4. Cache offline inmediata

Después de importar un Maestro o crear una excepción, la pantalla intenta refrescar inmediatamente el snapshot local usando el contrato existente de `refreshMasterSnapshot`.

Resultado operativo:

- servidor = autoridad y auditoría;
- SQLite/IndexedDB = lectura de captura;
- pérdida de red posterior = no bloquea el conteo mientras exista contexto autorizado válido.

## Lo que F14 no hace

- No modifica producción.
- No ejecuta migraciones remotas automáticamente.
- No cambia Softland.
- No hace ajustes de stock.
- No debilita RLS/RPC.
- No convierte la Referencia RP de conciliación en un pegado parcial: esa evidencia sigue requiriendo el libro completo para validar `STOCK TOTAL`, `STOCK CON P` y `STOCK CON S` de forma cruzada.

## Archivos principales

- `src/features/master/master-import-parser.ts`
- `src/features/master/master-sku-screen.tsx`
- `src/services/supabase-master-sku-repository.ts`
- `supabase/migrations/20261003163000_f14_smart_master_import.sql`
- `tests/unit/master-import.test.ts`
- `supabase/tests/phase_2_master_test.sql`

## Gate de despliegue

F14 queda lista para revisión de ingeniería en rama aislada. Aplicar la migración en INVEN3-QA requiere autorización separada. Producción permanece bloqueada.
