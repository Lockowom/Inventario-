# Conteo físico v1 — Fase 3

La captura es exclusivamente local y offline-first. Al iniciar, la entrada intenta siempre una verificación autoritativa: Auth, perfil activo, RLS, exactamente un inventario asignado y estado `ABIERTO`. Si resulta `AUTHORIZED`, actualiza el **last-known authorized counting context** persistente y crea el runtime; ningún campo de usuario o inventario es editable en la pantalla. Los estados `BORRADOR`, `PREPARADO`, `CERRADO` y `CONGELADO`, cero o más de un inventario abierto, o una respuesta `NOT_AUTHORIZED`/`AMBIGUOUS`, mantienen la captura bloqueada y no reutilizan una copia antigua.

Ante `UNAVAILABLE` real del backend, el runtime puede reconstruirse sólo desde ese contexto previamente verificado, la identidad de la sesión local del mismo `user_id` y el maestro local. El contexto no contiene tokens ni concede una autorización nueva; logout y cambio de usuario lo invalidan. Por tanto, mientras un dispositivo está totalmente offline opera contra el último estado `ABIERTO` confirmado por servidor: no puede conocer un cierre remoto ocurrido durante la desconexión. Al recuperar conectividad, el servidor vuelve a prevalecer. Sin maestro local, el contexto autorizado no habilita captura.

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

La confirmación visual sólo ocurre tras la transacción local. Ante error, el formulario conserva los datos. “Mis conteos” muestra únicamente conteos propios del inventario y permite búsqueda local por código, serie, partida o ubicación. La pantalla informa `Pendientes: N / 50`: advertencia textual en 40–44, advertencia crítica en 45–49 y bloqueo textual de `GUARDAR` en 50.

`savePendingWithCapacity` es atómico: SQLite ejecuta `BEGIN IMMEDIATE`, cuenta y escribe en la misma transacción; Dexie hace el conteo y la escritura dentro de una transacción read-write. Por tanto dos intentos desde 49 producen un guardado y un rechazo, nunca 51.

## Fuera de alcance

No incluye sincronización productiva, `sync_counts`, stock, diferencias, cierres, cortes, rectificaciones ni modificaciones de schema/RLS remoto.
