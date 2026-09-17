# Sync engine v1 — Fase 4

La captura persiste antes de intentar red. `CaptureRuntime` sólo existe para un inventario `ABIERTO`; el motor no depende de él. Al iniciar con una sesión local válida, `SyncCoordinator` consulta `listOutstandingSyncScopes(user_id)` y crea un `SyncManager` single-flight por `(user_id, inventory_id)`. Esto permite reconciliar trabajo durable `PENDING`, `SYNCING` o `FAILED` aun cuando la captura esté bloqueada: `CERRADO` puede aceptar la recepción atrasada y `CONGELADO` recibe el rechazo terminal del servidor sin borrar el payload.

Cada manager reclama únicamente registros del outbox local para su usuario e inventario: `PENDING` o `FAILED` cuyo `next_retry_at` ya venció. Reclama en una transacción hasta 20 y cambia a `SYNCING`; al reiniciar, un reclamo abandonado vuelve a `FAILED` sin perder los campos físicos.

`SyncManager` es singleflight: dos disparadores (inicio, guardado o botón) comparten una sola ejecución. Envía lotes secuenciales hacia `sync_counts`. Una respuesta `ACCEPTED` o `ALREADY_ACCEPTED` sólo confirma localmente si trae el mismo `client_count_id`, `server_count_id` y `received_at`; `REJECTED`/`CONFLICT` se hacen terminales locales con razón. Un ACK inválido/parcial o un fallo de red no confirma nada no reconocido: deja los restantes `FAILED`, incrementa intentos y programa backoff exponencial con jitter.

El adaptador de Supabase traduce sus respuestas a `SyncTransportError`; el dominio nunca interpreta errores crudos de Supabase/PostgREST. `TRANSIENT` (red, timeout inequívoco, 502/503/504) deja `FAILED` con backoff; `TERMINAL_AUTHORIZATION` (401/403/42501), `TERMINAL_CONTRACT` (42P01/42703/PGRST/respuesta incompatible) y `UNKNOWN_FAIL_CLOSED` conservan el dato en `REJECTED` con código seguro y revisión visible. El registro de dispositivo informa diagnóstico seguro sin modificar registros; el reporte de pendientes es best-effort y nunca altera el outbox.

La interfaz es deliberadamente mínima: botón “Sincronizar ahora” cuando hay captura activa, y estado operacional cuando no hay inventario `ABIERTO` pero existe outbox pendiente. El guardado no espera red ni borra el formulario por un error de transporte.

No se implementan cortes, exportación, rectificación, sync de maestros ni borrado operativo en esta fase.
