# Sync engine v1 — Fase 4

La captura persiste antes de intentar red. El motor toma únicamente registros del outbox local para el usuario e inventario autorizados: `PENDING` o `FAILED` cuyo `next_retry_at` ya venció. Reclama en una transacción hasta 20 y cambia a `SYNCING`; al reiniciar, un reclamo abandonado vuelve a `FAILED` sin perder los campos físicos.

`SyncManager` es singleflight: dos disparadores (inicio, guardado o botón) comparten una sola ejecución. Envía lotes secuenciales hacia `sync_counts`. Una respuesta `ACCEPTED` o `ALREADY_ACCEPTED` sólo confirma localmente si trae el mismo `client_count_id`, `server_count_id` y `received_at`; `REJECTED`/`CONFLICT` se hacen terminales locales con razón. Un ACK inválido/parcial o un fallo de red no confirma nada no reconocido: deja los restantes `FAILED`, incrementa intentos y programa backoff exponencial con jitter.

La interfaz es deliberadamente mínima: botón “Sincronizar ahora”, estado de actividad y estado por conteo. El guardado no espera red ni borra el formulario por un error de transporte.

No se implementan cortes, exportación, rectificación, sync de maestros ni borrado operativo en esta fase.
