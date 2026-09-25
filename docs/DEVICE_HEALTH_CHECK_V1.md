# Health Check del dispositivo v1 — contrato pendiente

Estado: `CONTRACT_PENDING / NOT_IMPLEMENTED`. Este documento cierra el contrato de la sección 47 del Blueprint; no crea UI, adapters, permisos, RPC, migraciones ni cambios de RLS.

## Propósito y resultado

Antes de una jornada, y bajo demanda, INVEN3 evaluará la capacidad del dispositivo para capturar inventario sin exponer credenciales ni datos privados. El resultado propuesto será una de estas salidas:

- `DISPOSITIVO LISTO PARA INVENTARIO`: todos los prerrequisitos de captura local están en `PASS`.
- `DISPOSITIVO LISTO PARA INVENTARIO OFFLINE`: prerrequisitos locales en `PASS`; conectividad backend degradada según la política pendiente.
- `REVISIÓN REQUERIDA`: existe al menos un check bloqueante en `FAIL`.
- detalle seguro de cada check, sin tokens, SQL, rutas de Storage ni mensajes internos.

El modelo mínimo de estado propuesto es `PASS`, `WARN`, `FAIL` y `UNAVAILABLE`. `UNAVAILABLE` significa que la plataforma no puede ejecutar esa observación; no equivale por sí solo a `FAIL`. La decisión de bloqueo se deriva por check y por política, no de una regla global de estado.

## Contrato de checks

| Check | Fuente y método futuro | Plataformas | Resultado y bloqueo propuesto | Offline | Mensaje seguro al usuario | Evidencia QA |
|---|---|---|---|---|---|---|
| `APP_VERSION` | versión compilada (`VITE_APP_VERSION`) y versión nativa cuando Capacitor la exponga; comparar sólo contra política aprobada | Web, Android, iOS | `PASS` si identificable; `WARN` si no se puede comparar con política; bloqueo por versión mínima es `DECISION_REQUIRED` | Sí, identifica build local | “Versión instalada: …” o “No fue posible verificar la política de versión.” | build/SHA, SO y captura de pantalla en `DEVICE_QA_V1.md` |
| `AUTH_USER` | sesión autenticada local y perfil activo/cache autorizado; no mostrar JWT | Web, Android, iOS | `FAIL` sin usuario autenticado o perfil inactivo; bloqueante para captura | Sólo con sesión/contexto local válido; reglas de expiración offline son `DECISION_REQUIRED` | “Inicie sesión con un usuario activo.” | login de prueba Android/iOS |
| `INVENTORY_CONTEXT` | contexto autorizado seleccionado/cached, inventario `ABIERTO`, asignación vigente | Web, Android, iOS | `FAIL` si falta contexto, asignación o inventario abierto; bloqueante | Sí, sólo con contexto previamente verificado y cacheado | “Seleccione un inventario abierto autorizado.” | login, inventario y maestro offline disponibles |
| `MASTER_SNAPSHOT` | repositorio de maestro: metadata y snapshot local | Web/Dexie, Android/iOS SQLite | `PASS` sólo si `inventory_id` coincide, metadata existe, `row_count > 0` y snapshot es legible; `FAIL` bloqueante en otro caso | Sí | “El maestro de este inventario no está disponible localmente.” | maestro offline y búsqueda SKU |
| `LOCAL_DATABASE` | abrir repositorio local, lectura y transacción técnica de prueba en namespace de salud, sin escribir conteos de negocio | Web/Dexie, Android/iOS SQLite | `FAIL` si no abre/lee/escribe transaccionalmente; bloqueante | Sí | “La base local no está disponible. No capture conteos.” | guardar, cerrar/reabrir y revisar pendiente |
| `CAMERA_AVAILABLE` | capacidad nativa/Barcode Detection API, no inferida de permiso | Web, Android, iOS | `PASS` disponible; `UNAVAILABLE` sin capacidad; propuesta `WARN` no bloqueante porque la digitación manual permanece contractual | Sí | “Cámara no disponible; puede ingresar los datos manualmente.” | prueba cámara por dispositivo |
| `CAMERA_PERMISSION` | estado de permiso del adaptador nativo o navegador, separado de capacidad | Web, Android, iOS | `PASS` concedido; `WARN` denegado/no solicitado, no bloqueante mientras exista digitación manual | Sí | “Permiso de cámara no concedido; puede ingresar los datos manualmente.” | aceptar y rechazar permiso |
| `SCANNER_AVAILABLE` | inicialización/capacidad del adaptador y, Android, disponibilidad del módulo Google Scanner | Web, Android, iOS | `PASS` inicializable; `WARN`/`UNAVAILABLE` no bloqueante por ingreso manual contractual; si una futura operación exige escaneo, su bloqueo es `DECISION_REQUIRED` | Sí | “Scanner no disponible; puede ingresar los datos manualmente.” | QR, Code128, cancelar y restauración |
| `LOCAL_STORAGE` | Web: disponibilidad IndexedDB y cuota estimada sin umbral inventado. Móvil: apertura SQLite y espacio reportable si el SO/adaptador lo permite sin nuevo plugin | Web, Android, iOS | `PASS` almacenamiento operativo; `WARN` si cuota/espacio no observable; `FAIL` si no puede persistir; `FAIL` es bloqueante | Sí | “No hay almacenamiento local disponible para proteger los conteos.” | SQLite y espacio disponible en matriz física |
| `BACKEND_CONNECTIVITY` | consulta autorizada mínima, sin RPC nueva ni datos sensibles; definir endpoint y timeout en diseño posterior | Web, Android, iOS | `PASS` alcanzable; `WARN` no alcanzable con prerrequisitos locales válidos. Política de inicio de jornada sin red es `DECISION_REQUIRED` | No para la observación; sí para captura cuando lo local está listo | “Servidor no disponible ahora. Puede trabajar offline y sincronizar después.” | desconexión/reconexión y sync posterior |
| `DEVICE_TIME` | reloj local ISO; comparación con referencia firmada/autorizada sólo cuando exista conectividad | Web, Android, iOS | `PASS` si reloj legible; deriva de comparación/tolerancia es `DECISION_REQUIRED`. `UNAVAILABLE` para drift sin referencia no bloquea por ahora | Sí para lectura local; no para comparación | “No fue posible comparar la hora del dispositivo con el servidor.” | registrar hora local, hora de referencia y diferencia |

## Semántica de bloqueo y decisiones pendientes

Los checks de identidad, contexto, maestro y persistencia local son prerrequisitos propuestos de captura: `AUTH_USER`, `INVENTORY_CONTEXT`, `MASTER_SNAPSHOT`, `LOCAL_DATABASE` y un `LOCAL_STORAGE` que no puede persistir deben bloquear. Cámara, permiso y scanner son advertencias por el flujo manual contractual de `SCANNER_V1.md`.

Las siguientes decisiones no se fijan en este contrato:

1. `DECISION_REQUIRED — BACKEND_CONNECTIVITY`: el Blueprint es offline-first y permite trabajar offline, pero no define si una jornada nueva puede iniciarse sin conexión. La propuesta permite captura offline sólo con usuario, contexto y maestro previamente verificados; la autoridad operativa debe aprobarla.
2. `DECISION_REQUIRED — DEVICE_TIME`: faltan referencia autorizada, tolerancia de drift y conducta offline. No se creará RPC ni se inventará una tolerancia.
3. `DECISION_REQUIRED — APP_VERSION`: falta política de versión mínima/obsoleta y si bloquea.
4. `DECISION_REQUIRED — AUTH_USER offline`: falta la regla de expiración/renovación de sesión para comenzar una jornada sin red.
5. `DECISION_REQUIRED — LOCAL_STORAGE`: falta un umbral de espacio mínimo que sea válido por plataforma; no se añadirá plugin nativo sólo para medirlo.
6. `DECISION_REQUIRED — scanner obligatorio`: el flujo general conserva digitación manual; una excepción por operación requeriría cambio funcional aprobado.

## Base local y maestro

El probe de `LOCAL_DATABASE` deberá usar una operación técnica aislada y transaccional, con lectura/escritura/rollback o limpieza garantizada en un namespace que no sea `count_records`. No debe crear UUID, pendientes, auditoría ni conteos ficticios. Su esquema o mecanismo exacto requiere diseño aprobado antes de implementación.

`MASTER_SNAPSHOT` no se satisface por la mera existencia de una tabla: debe comprobar que el snapshot pertenece al inventario seleccionado, que metadata está disponible, que `row_count` es válido y que se puede leer para resolver trabajo offline.

## UI y ejecución futura

La futura pantalla se titulará **HEALTH CHECK DEL DISPOSITIVO** y mostrará checks, estado, mensaje seguro, hora de ejecución y acción **ACTUALIZAR**. Se propondrá ejecución en: inicio de app (diagnóstico liviano), post-login, selección/cambio de inventario, antes de jornada y refresh manual. La evaluación intensiva de cámara/scanner debe ser explícita y nunca abrir cámara automáticamente.

No debe exponer `service_role`, JWT, tokens, rutas sensibles de Storage, SQL ni metadata privada. No requiere privilegios, RPC ni backend nuevos bajo este contrato.

## Matriz QA futura y rendimiento físico

Cada check se registrará en `DEVICE_QA_V1.md` para Android angosto, estándar, grande, alta densidad y tablet Android; iPhone compacto, estándar, grande e iPad. La evidencia debe incluir modelo, SO, build/SHA, responsable, fecha, resultado y capturas no sensibles.

Los siguientes objetivos del Blueprint son gates físicos futuros, no resultados de CI de escritorio:

- guardar SQLite local < 300 ms normalmente;
- buscar SKU local < 300 ms;
- abrir formulario < 1 s en dispositivo objetivo;
- sync nunca bloquea captura.

## Límites de esta fase

Este contrato no implementa Health Check y no modifica migraciones, RPC, RLS, Edge Functions, Storage, permisos nativos, scanner, SQLite ni UI productiva.
