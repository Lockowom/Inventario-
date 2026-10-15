# Aceptación RP/Softland — Fase 9

Estado de certificación: `RP_REAL_IMPORT = BLOCKED_EXTERNAL`. INVEN3 no conecta, opera ni modifica RP automáticamente. La importación controlada sólo la ejecuta un operador humano autorizado conforme al [paquete F9B](F9B_EXECUTION_PACK.md) y la [plantilla RP](f9b/RP_EXECUTION_TEMPLATE.md).

## Precondiciones

- Ambiente permitido: `TEST`, `SANDBOX` o `AUTHORIZED_CONTROLLED`.
- Si sólo existe producción o falta autorización explícita: registrar `BLOCKED_EXTERNAL` y no importar.
- Registrar `environment_name`, `environment_type`, `cut_id`, `cut_number`, `file_name`, `sha256`, `size_bytes`, `record_count` y `generated_at`.

## Procedimiento humano controlado

1. Seleccionar un corte y XLSX generado con datos de prueba.
2. Registrar hash y tamaño antes de la importación; conservar referencias de evidencia.
3. Verificar dataset: SERIAL, PARTIDA y LEGACY; códigos con ceros iniciales, serie texto, partida `00725`, pieza `001234`, fecha Excel real, fecha vacía, talla/color, blanks, cantidad entera y cero fórmulas.
4. Ejecutar la importación en RP por el operador autorizado.
5. Registrar inicio/fin UTC, filas totales/aceptadas/rechazadas, warnings, errors, mensajes RP y defectos.

Errores de fecha RP, lotes alterados y ceros iniciales alterados deben ser cero para una ejecución satisfactoria. Esta prueba no es conciliación ni ajuste de stock. Ningún estado cambia automáticamente.
