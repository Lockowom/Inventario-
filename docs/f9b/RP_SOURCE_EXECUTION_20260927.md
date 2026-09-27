# Certificación de fuente real RP — 2026-09-27

Estado: `RP_SOURCE_REAL_DATASET = PASS_WITH_WARNINGS`.

Esta ejecución valida como dataset de prueba un libro real exportado desde RP/Softland. El archivo no se incorpora al repositorio y no se usa para mutar stock remoto.

## Identidad del archivo

| Campo | Valor |
|---|---|
| file_name | `STOCK RP(2).xlsx` |
| sha256 | `6b43ab792ca73210888c316c2886d373a7d4b937f22f3b0145ce272c36f54fa3` |
| size_bytes | `442498` |
| sheets | `STOCK TOTAL`, `STOCK CON P`, `STOCK CON S` |

## Resultado estructural

| Control | Resultado |
|---|---|
| STOCK TOTAL | 2453 filas / 2453 SKU únicos |
| STOCK CON P | 3054 filas / mismos 2453 SKU |
| STOCK CON S | 4050 filas / mismos 2453 SKU |
| conciliación por SKU | 0 diferencias en Disponible/Reserva/Transitoria/Consignación/Stock Total |
| fórmulas | 0 |
| SKU + partida duplicados | 0 |
| series | 1679 |
| series duplicadas | 0 |
| cantidad por serie | 1 en todos los registros con serie |
| SKU SERIAL con detalle | 82 |
| fechas de vencimiento informadas | 174 / 174 parseables |
| códigos con espacios externos | 5 SKU normalizables por trim |

## Warnings de calidad de datos

- 20 SKU tipo PARTIDA con stock positivo aparecen sin `Partida / Talla`; total asociado: 353 unidades.
- Se observan 2 fechas anteriores al año 2000 (1931 y 1932). Son parseables, pero requieren revisión de dato fuente.
- Existe al menos un stock de estado negativo en `Reserva`; el total consolidado sigue cuadrando aritméticamente. Se registra como warning, no como corrupción del archivo.
- Los espacios externos en 5 códigos quedan cubiertos por la normalización `trim()` de INVEN3.

## Compatibilidad INVEN3

El encabezado real de RP utiliza `Cod. Producto` y `Producto`. El importador de maestro fue ampliado para aceptar estos aliases además del contrato histórico `CODIGO` / `DESCRIPCION`.

La fuente canónica para el maestro offline queda:

- `STOCK TOTAL`: universo SKU + descripción;
- `STOCK CON P`: validación/trazabilidad de partidas;
- `STOCK CON S`: validación/trazabilidad de series.

Runner reproducible:

`npm run certify:f9b:rp-source -- "C:\\ruta\\STOCK RP(2).xlsx"`

La salida genera evidencia JSON bajo `artifacts/f9b-rp-source/`.

## Alcance del gate

Esta prueba certifica `RP_SOURCE_REAL_DATASET` y compatibilidad de entrada de datos reales de RP hacia INVEN3.

No reemplaza `RP_REAL_IMPORT`, que según el contrato F9 sigue siendo la importación controlada del XLSX generado por INVEN3 hacia RP/Softland por un operador autorizado.
