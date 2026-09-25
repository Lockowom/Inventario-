# Health Check del dispositivo v1 — contrato cerrado

Estado: `CONTRACT_READY / NOT_IMPLEMENTED`. Este documento fija las políticas funcionales para una implementación futura; no crea UI, adapters, permisos, RPC, migraciones, RLS, telemetría ni cambios en la captura.

## Alcance y autoridad existente

Health Check no es una nueva fuente de autorización ni de datos. Debe consumir las garantías existentes sin reinterpretarlas:

- `resolveCountingContext()` conserva la regla **server answers win**: `AUTHORIZED` produce `ONLINE`; `UNAVAILABLE` sólo permite `OFFLINE` con cache válido y el mismo `localSessionUserId`; `NOT_AUTHORIZED` y `AMBIGUOUS` producen `BLOCKED` y limpian el cache.
- `verifyServerCountingContext()` continúa comprobando `getUser()`, perfil activo, asignación e inventario `ABIERTO` contra el servidor. Al reconectar, esa respuesta vuelve a ser autoritativa sin período de gracia.
- El maestro se consulta sólo mediante `MasterSkuRepository`, metadata y lookup existentes; no habrá una copia de maestro para Health Check.
- Cámara y scanner reutilizarán `src/scanner/` y `SCANNER_V1.md`; no habrá un segundo scanner.

No se modifican en esta fase `authorized-counting-context.ts`, `resolve-counting-context.ts`, `counting-runtime.ts`, `barcode-scanner.ts`, `SCANNER_V1.md` ni `DEVICE_SYNC_V1.md`.

## Estados y resultado global

Cada check retorna `PASS`, `WARN`, `FAIL` o `UNAVAILABLE`. `UNAVAILABLE` no implica automáticamente fallo: su criticidad se determina por este contrato.

Sólo existen cuatro resultados globales:

| Resultado | Label de UI | Regla |
|---|---|---|
| `READY` | **DISPOSITIVO LISTO PARA INVENTARIO** | Todos los checks aplicables en `PASS`. |
| `READY_OFFLINE` | **DISPOSITIVO LISTO PARA INVENTARIO OFFLINE** | Sin `FAIL` bloqueante, `BACKEND_CONNECTIVITY` no disponible y `resolveCountingContext()` válido en `OFFLINE`. |
| `READY_WITH_WARNINGS` | **DISPOSITIVO LISTO CON ADVERTENCIAS** | Sin `FAIL` bloqueante, backend disponible y uno o más `WARN`/`UNAVAILABLE` no críticos. |
| `BLOCKED` | **REVISIÓN REQUERIDA** | Cualquier `FAIL` bloqueante. |

La pantalla de conteo futura sólo bloqueará captura si el resultado global es `BLOCKED`; no por `WARN`, `UNAVAILABLE` no crítico, `READY_OFFLINE` ni `READY_WITH_WARNINGS`.

## Contrato final de checks

| Orden | Check | Fuente y método futuro | Resultado y bloqueo | Comportamiento offline / mensaje seguro |
|---:|---|---|---|---|
| 1 | `APP_VERSION` | `VITE_APP_VERSION` con fallback de build `0.1.0` y versión nativa si Capacitor la expone. | Identificable: `PASS`; no identificable: `WARN`, no bloqueante. No hay versión mínima, forced upgrade ni bloqueo v1. El diseño acepta una política futura de rollout sin reescribir el dominio. | Local: “No fue posible identificar la versión instalada.” Health sólo informa; no descarga bundles, APK ni gestiona App Store. |
| 2 | `AUTH_USER` | Identidad de sesión persistida del cliente Supabase y el resultado de `resolveCountingContext()`. | Sin identidad local del usuario: `FAIL` bloqueante. No se exige refresh remoto sin red. | Requiere identidad persistida y `cached.userId === localSessionUserId`; de otro modo bloquea. Mensaje: “Inicie sesión con un usuario activo.” |
| 3 | `INVENTORY_CONTEXT` | `resolveCountingContext()` y contexto de conteo seleccionado. | Sólo `ABIERTO` y `ONLINE` autorizado por servidor o `OFFLINE` cacheado válido. Cualquier `BLOCKED`, contexto ausente o estado distinto de `ABIERTO`: `FAIL` bloqueante. | El cache no autoriza tras respuesta `NOT_AUTHORIZED` o `AMBIGUOUS`. Mensaje: “Seleccione un inventario abierto autorizado.” |
| 4 | `MASTER_SNAPSHOT` | `MasterSkuRepository.getMetadata`, `listByInventory` y `findByCode`. | Exige mismo `inventoryId`, metadata legible, `rowCount > 0`, filas legibles con cardinalidad coherente y lookup real de una fila del snapshot. Cualquier incumplimiento: `FAIL` bloqueante. | Válido offline si ya reside localmente. Mensaje: “El maestro de este inventario no está disponible localmente.” |
| 5 | `LOCAL_DATABASE` | Puerto técnico de probe común para Dexie/SQLite, explicado abajo. | Debe abrir, leer y demostrar write/transaction seguro; error: `FAIL` bloqueante. | Opera localmente. Mensaje: “La base local no está disponible. No capture conteos.” |
| 6 | `LOCAL_STORAGE` | Resultado de persistencia local y estimación de cuota sólo cuando la plataforma la exponga. | Persistencia operativa: `PASS`; cuota/espacio no observable: `WARN` no bloqueante; incapacidad de persistir: `FAIL` bloqueante. No hay umbral MB/GB v1. | Web puede informar `navigator.storage.estimate()`; móvil puede reportar cuota física `UNAVAILABLE` sin plugin nuevo. |
| 7 | `BACKEND_CONNECTIVITY` | Resultado de `verifyServerCountingContext()` y resolución existente, no un endpoint paralelo. | `AUTHORIZED`/`ONLINE`: `PASS`. `UNAVAILABLE` con cache válido y mismo usuario: `WARN`, no bloqueante. Sin cache autorizado o identidad coincidente: el contexto queda `BLOCKED`. | Con prerrequisitos locales válidos: “Servidor no disponible ahora. Puede trabajar offline y sincronizar después.” |
| 8 | `DEVICE_TIME` | `Date.now()` y `new Date().toISOString()`; con backend online, referencia PostgreSQL futura. | Runtime sin fecha ISO válida: `FAIL` bloqueante. Con referencia online, drift absoluto `<= 5 min`: `PASS`; `> 5 min`: `FAIL` y bloquea nueva captura. | Con reloj válido y contexto `OFFLINE`: `WARN`, no bloquea: “No fue posible comparar la hora del dispositivo con el servidor.” |
| 9 | `CAMERA_AVAILABLE` | Capacidad del adaptador nativo o navegador, separada del permiso. | Disponible: `PASS`; no disponible: `WARN`/`UNAVAILABLE`, no bloqueante porque existe digitación manual. | “Cámara no disponible; puede ingresar los datos manualmente.” |
| 10 | `CAMERA_PERMISSION` | Consulta pasiva de permiso disponible por adaptador; nunca solicita permiso automáticamente. | Concedido: `PASS`; denegado, no solicitado o restringido: `WARN`, no bloqueante. En Android Google Scanner ready-to-use, cámara de INVEN3 no es requerida: se informa `UNAVAILABLE`/no aplicable, nunca falso `FAIL`. | Solicitud de permiso sólo por acción explícita del usuario. Mensaje: “Permiso de cámara no concedido; puede ingresar los datos manualmente.” |
| 11 | `SCANNER_AVAILABLE` | Capacidad/inicialización segura de `src/scanner/`; Android verifica disponibilidad del módulo Google Scanner sin abrir lectura. | Inicializable: `PASS`; no disponible: `WARN`/`UNAVAILABLE`, no bloqueante. Scanner nunca es requisito de captura en INVEN3 v1. | “Scanner no disponible; puede ingresar los datos manualmente.” |

No se agregan checks por conveniencia. La ausencia de scanner, cámara o permiso no convierte la captura manual en `BLOCKED`.

## Política de conectividad, identidad y reconexión

La política v1 queda cerrada así:

```text
BACKEND disponible
  → verificación server-authoritative normal

BACKEND no disponible + resolveCountingContext = OFFLINE
  → BACKEND_CONNECTIVITY = WARN
  → no bloquear captura

BACKEND no disponible + sin contexto cacheado autorizado
o sin identidad local del mismo usuario
  → BLOCKED
```

Por tanto, si `AUTH_USER`, `INVENTORY_CONTEXT`, `MASTER_SNAPSHOT`, `LOCAL_DATABASE` y `LOCAL_STORAGE` son válidos y backend no está disponible, el resultado es exactamente **DISPOSITIVO LISTO PARA INVENTARIO OFFLINE**, no “REVISIÓN REQUERIDA”. Al volver la conexión, `getUser()`, perfil activo, asignación e inventario `ABIERTO` vuelven a decidir; `NOT_AUTHORIZED` o `AMBIGUOUS` invalidan el contexto local de inmediato.

## Probe de base local y almacenamiento

Se revisaron los adapters actuales. El mecanismo mínimo común propuesto es un puerto de infraestructura semántico, por ejemplo `LocalHealthProbe`, que exponga sólo abrir, lectura y transacción/write; el dominio no conocerá SQL ni Dexie.

- **Dexie:** abre `Inven3WebDatabase`, lee `runtimeState` y, dentro de una transacción `rw`, escribe, lee y elimina una clave técnica con prefijo reservado `health_probe:`. La transacción confirma sin residuo persistente.
- **SQLite:** inicializa la conexión y migraciones existentes, lee `pragma user_version` y ejecuta una transacción sobre una tabla temporal de nombre técnico, por ejemplo `health_probe`. Inserta/lee un marcador estático y la elimina antes de commit.

Ambos mecanismos demuestran apertura, lectura y capacidad transaccional de escritura sin crear `count_record`, `client_count_id`, pendiente, auditoría ni esquema persistente. No se crea tabla, migración ni código ahora. La estimación de cuota es informativa y distinta de la persistencia operativa crítica.

## Política de tiempo

Health Check detecta, informa y bloquea cuando corresponde; nunca corrige la hora del sistema operativo. No obtiene “ahora” desde `iat`/`exp` de JWT, `last_sign_in_at`, `captured_at`, `received_at` histórico ni otra fecha previa.

La referencia preferida para una implementación futura es una RPC mínima `get_server_time()` que devuelva exclusivamente `clock_timestamp()`:

```text
SECURITY INVOKER
sin parámetros ni acceso a tablas
sin service_role
authenticated solamente
REVOKE PUBLIC
REVOKE anon
GRANT authenticated
```

La revisión del repositorio no encontró una alternativa actual que exponga la hora presente del servidor. Si se aprueba, se implementará posteriormente mediante migración forward-only local/CI, sin deploy remoto y sin `SECURITY DEFINER`. Mientras haya conectividad, se registrará la diferencia observada y se aplicará una única tolerancia operacional v1 de ±5 minutos. Si la referencia no puede obtenerse pese a backend disponible, el check será `WARN` y se reintentará; no se afirmará `PASS` sin comparación.

## Modos de ejecución y UI futura

| Modo | Cuándo | Alcance |
|---|---|---|
| `LIGHT` | Inicio, post-login y cambio/selección de inventario. | Checks seguros; no abre cámara ni solicita permisos. |
| `FULL` | Acción explícita **COMPROBAR DISPOSITIVO**. | Puede consultar soporte scanner, permiso y probes adicionales seguros; nunca inicia una lectura de código. |

La futura pantalla se titulará **HEALTH CHECK DEL DISPOSITIVO** y mostrará resultado global, hora del check, cada check, estado y mensaje seguro. Sus únicas acciones v1 serán **ACTUALIZAR** y **COMPROBAR DISPOSITIVO**.

## Seguridad y QA

Los mensajes no expondrán JWT, access/refresh token, `service_role`, SQL, rutas de Storage, errores internos ni metadata privada. La evidencia manual en `DEVICE_QA_V1.md` cubre Android angosto, estándar, grande, alta densidad y tablet; iPhone compacto, estándar, grande e iPad. Cada registro debe incluir modelo, SO, build/SHA, responsable, fecha, resultado y capturas no sensibles.

Los objetivos físicos futuros no son SLA de CI de escritorio: guardado SQLite y lookup SKU local normalmente <300 ms, apertura de formulario <1 s y sync no bloqueante para captura.

## Límites de esta fase

Este cierre es exclusivamente documental. Device Health está contractualmente listo, pero todavía no implementado; no se implementa Device Health, F9B ni Fase 10.
