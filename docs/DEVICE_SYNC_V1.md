# Device sync v1 — Fase 4

Un “dispositivo” de sincronización es un UUID opaco generado localmente para la combinación usuario/instalación. No contiene IMEI, serial, nombre físico ni un campo editable de plataforma. Android, iOS o Web se derivan de Capacitor; versión y etiqueta las deriva el adaptador de la aplicación.

`register_sync_device` crea o actualiza metadata sólo cuando `auth.uid()` coincide con el propietario. Un UUID ya asociado a otro usuario retorna `42501`; al cambiar de usuario en la misma instalación se crea una nueva inscripción. Las escrituras directas a `sync_devices` están revocadas.

Después de registrar, `report_device_sync_state` publica el total local conocido no terminal. Un valor positivo abre/actualiza una guarda de freeze por `(inventory_id, device_id)`; cero resuelve la guarda. La guarda evita congelar mientras existe trabajo conocido, sin afirmar que sea un bloqueo global de conectividad. La fuente final sigue siendo la validación de `sync_counts` al recibir cada registro.
