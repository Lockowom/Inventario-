# F14 — Centro de Carga

## Decisión de producto

INVEN3 tendrá una sola superficie para ingreso de datos de preparación:

**Navegación → Carga de datos**

Se eliminan las cargas de archivos desde Maestro SKU y Conciliación.

Esos módulos quedan orientados a operación posterior:

- Maestro SKU: estado del catálogo y excepciones durante ABIERTO.
- Conciliación: referencia activa, conciliación en vivo, hallazgos, recuentos y dictamen.

## Flujo único

1. Seleccionar inventario.
2. Validar Maestro SKU.
3. Confirmar Maestro.
4. Refrescar cache offline SQLite/IndexedDB.
5. Validar libro RP consolidado.
6. Resolver excepciones controladas de Partida/Talla ausente.
7. Confirmar referencia RP.
8. Continuar con preparación/apertura del inventario.

## Maestro SKU

Entradas admitidas desde el mismo paso:

- XLSX.
- CSV.
- TSV.
- TXT.
- Pegado directo desde Excel / Google Sheets.

Encabezados soportados:

- CODIGO / DESCRIPCION.
- Cod. Producto / Producto.

También se permiten dos columnas pegadas sin encabezado.

SKU repetidos con la misma descripción se consolidan. El mismo código con descripciones incompatibles bloquea el preview.

## Referencia RP

El flujo principal usa un único libro XLSX con:

- STOCK TOTAL.
- STOCK CON P.
- STOCK CON S.

El preview valida estructura, universo SKU, sumas, series duplicadas, partida/talla, vencimiento, valores negativos como evidencia y pertenencia al Maestro.

### Partida ausente

Si Softland informa stock positivo para un SKU PARTIDA sin Partida/Talla:

- no se inventa un lote;
- la fila queda pendiente de autorización;
- ADMIN registra un motivo;
- el backend autoriza la referencia técnica EXC-SIN-PARTIDA:<SKU>;
- el parser se ejecuta nuevamente;
- sólo entonces la referencia puede confirmarse.

## Reemplazo de Maestro

F14 elimina el DELETE total del Maestro.

La RPC import_inventory_master usa smart merge:

- conserva ID de SKU existentes;
- inserta SKU nuevos;
- actualiza descripción, tipo y origen;
- retira SKU omitidos sólo si no tienen conteos históricos;
- invalida la referencia RP anterior porque pertenece al universo previo;
- conserva historial de excepciones;
- mantiene autorizaciones de partida ausente sólo para SKU que sigan existiendo;
- recalcula versión, row_count y fingerprint.

Si un SKU a retirar tiene count_records, la operación falla de forma explícita.

## Offline-first

Después de confirmar Maestro:

Supabase authoritative snapshot → refreshMasterSnapshot → SQLite/IndexedDB

La captura consume el Maestro local. La pérdida posterior de conectividad no obliga a consultar el Maestro remoto mientras el contexto offline siga autorizado.

## Despliegue

- Base: F13.
- QA/BETA.
- Producción: LOCKED.
- La migración F14 no debe aplicarse a producción sin gate separado.
