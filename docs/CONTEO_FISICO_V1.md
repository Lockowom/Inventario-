# Conteo físico v1 — Fase 3

La captura es exclusivamente local y offline-first. Requiere un contexto autenticado con inventario `ABIERTO`; no crea estados, no consulta stock, no muestra diferencias y no llama Supabase.

## Formulario A:J

1. `UBICACION`: obligatoria, `A|B|C|C2|D|F|G|H|I-XX-YY`. Ante error: `Ubicación mal digitada. Verifique el formato y el pasillo. Ejemplos válidos: F-32-03 o C2-32-03.`
2. `CODIGO`: obligatorio y existente en el maestro local del inventario. La descripción se rellena sólo desde ese maestro.
3. `SERIE`: para SKU `SERIAL`, obligatoria y máximo 19 caracteres; cantidad queda fija en 1 y partida se ignora.
4. `PARTIDA`: para SKU `PARTIDA`, obligatoria; conserva ceros iniciales y serie se ignora.
5. `PIEZA DEL PRODUCTO`: opcional.
6. `FECHA DE VENCIMIENTO`: opcional, ISO `YYYY-MM-DD` y fecha calendario válida.
7. `Talla del producto`: opcional.
8. `Color del Producto`: opcional.
9. `Cantidad Contada`: entero positivo; `SERIAL` fuerza 1.
10. `DESCRIPCION`: sólo lectura, procedente del maestro local.

`LEGACY` permite serie y partida opcionales. Cambiar código/tipo limpia campos que pertenecían al SKU anterior. Un mismo SKU puede figurar en múltiples ubicaciones: la unicidad se limita a `client_count_id`.

## Persistencia y capacidad

Antes de guardar se crean `id` y `client_count_id` UUID, se toma `captured_at` UTC y se obtiene una identidad persistente del dispositivo. Todo conteo nuevo inicia `PENDING`. Se guardan como máximo 50 `PENDING` por dispositivo: 0–39 normal, 40–44 advertencia, 45–49 crítico y 50 bloquea nuevos guardados sin borrar datos.

La confirmación visual sólo ocurre tras la transacción local. Ante error, el formulario conserva los datos. “Mis conteos” muestra únicamente conteos propios del inventario y permite búsqueda local por código, serie, partida o ubicación.

## Fuera de alcance

No incluye sincronización productiva, `sync_counts`, stock, diferencias, cierres, cortes, rectificaciones ni modificaciones de schema/RLS remoto.
