# CUT2-11C — Android Physical QA

Fecha: 2026-11-10
Estado: `IN_PROGRESS_CUT2_11C_ANDROID_QA`

## Alcance y frontera

- Backend permitido: `https://kpsdephjbvkwvazxubtb.supabase.co`.
- No se usó el QA histórico, producción, ERP/Softland, OTA de producción ni se realizaron mutaciones de stock.
- No se ejecutaron `db reset` ni `migration repair`. La única migración QA posterior queda documentada en la sección de contexto C1 y no altera datos operacionales.

## APK QA preparada y auditada

| Campo | Evidencia |
| --- | --- |
| Artefacto | `android/app/build/outputs/apk/debug/app-debug.apk` |
| Paquete | `com.lockowom.inven3` |
| Versión | `1.0.0` (`versionCode` 10000) |
| SHA-256 | `62906C0DBDE7D47E0B1E74019FC124B4979D666594A836A38185742F0833D6D4` |
| Canal/backend | QA nuevo `kpsdephjbvkwvazxubtb` |
| OTA endpoint nativo | QA nuevo `/functions/v1/ota-updates`; `autoUpdate=off` |
| QA histórico en contenido empaquetado | No encontrado |
| Literales `service_role` en config o bundle empaquetado | No encontrados |
| Permiso de cámara | Declarado; alternativa manual/lector permanece disponible |

Un artefacto histórico y `.env.qa.local` apuntaban al QA histórico; no se reutilizaron para el candidato actual. La APK inspeccionada en el dispositivo se documenta abajo y apunta al QA nuevo. Los builds nuevos reciben URL y clave pública del QA nuevo sólo durante el proceso de build; no se escriben claves en repositorio, documentación o logs.

## Diagnóstico de login QA_ADMIN

- La APK instalada se inspeccionó por ADB antes de que el dispositivo se desconectara: `com.lockowom.inven3`, versión `1.0.0`/`10000`, SHA-256 `F3066FAFDEE7A1675C92F49DCB2BCF5E074742966F8CDFD36E76D87BA8F6B2C0`.
- El bundle instalado contiene exactamente el host **y** la clave pública del QA nuevo `kpsdephjbvkwvazxubtb`; no contiene el QA histórico, producción ni `service_role`.
- CapacitorUpdater tiene `autoUpdate=off`. El sandbox de la app no mostró directorios de bundles Capgo activos, sólo el identificador de dispositivo; no hay evidencia de un OTA que sustituya el bundle base.
- Por lo tanto `ANDROID_QA_APP_CONFIG_FAILURE` queda descartado para la APK instalada. Con Auth directo PASS, el incidente pendiente se clasifica como `BLOCKED_ANDROID_QA_RUNTIME_LOGIN`: falta capturar la fase, código Auth y HTTP status en el dispositivo tras una nueva tentativa de login.
- El candidato actual con selección C1 explícita tiene SHA-256 `A86BEC8D4A173DEAA124B843530EEBF7FFCC75985F0BD9CA79EE41436F2F2AD4` y conserva el mismo target QA nuevo.
- `npm run android:qa:debug` es ahora el único build reproducible de QA: obtiene la clave pública del proyecto nuevo sólo en memoria, fuerza el URL permitido, elimina variables de service-role del proceso y genera/sincroniza la APK. No consume `.env.qa.local` como autoridad de QA.
- El cliente conserva el mensaje de login seguro. En builds QA registra internamente sólo `AuthError.code` y `status` en Logcat/memoria; no registra mensaje del servidor, correo, contraseña, token ni clave.
- Los workflows `android-qa-base-ota.yml` y `ota-qa-beta.yml` quedaron apuntando al QA nuevo. Antes de ejecutarlos en GitHub debe actualizarse el secreto protegido de clave pública QA para que corresponda a este proyecto; no se consultó ni modificó ningún secreto remoto durante este diagnóstico.

La instalación limpia se inició con el dispositivo conectado: `adb uninstall`
terminó correctamente y eliminó la versión anterior; `adb install` fue rechazado
por el propio Android con `INSTALL_FAILED_USER_RESTRICTED` antes de instalar el
APK. No es una falla de compilación ni una mutación de backend. Falta aceptar
la instalación por USB o habilitar esa autorización en el dispositivo para
continuar con la prueba física.

## Verificaciones no físicas

- `npm run build:qa` y `npx cap sync android`: PASS.
- `gradlew assembleDebug --no-daemon`: PASS.
- Inspección del APK y assets de Capacitor: QA nuevo presente; QA histórico y `service_role` ausentes.
- Contratos locales de SQLite/outbox/offline/auth/scanner: 6 archivos / 36 pruebas PASS; no sustituyen la evidencia en dispositivo físico.

## C1 online bajo demanda — 2026-11-10

- Cliente: **190 archivos / 498 pruebas PASS**; incluye los contratos de
  apertura C1 sin Maestro local, lookup RPC de SKU/trazabilidad y rechazo de
  fallback a lectura de tabla.
- Chromium: **37/37 PASS**. Los fixtures certifican que el botón de guardar
  sólo se habilita una vez resuelto un SKU, sin ninguna sincronización previa
  de planilla.
- Typecheck y lint: PASS.
- La APK QA se reconstruyó con la implementación C1 bajo demanda y fue
  auditada: ref QA nuevo presente, QA histórico ausente y literal
  `service_role` ausente.

## Contexto C1 y Health Check desacoplados — 2026-11-10

### Causa raíz

El contrato heredado de `get_my_counting_authorization_snapshot()` sólo emitía
`AUTHORIZED` cuando el actor veía **exactamente un** inventario `ABIERTO`.
Para un ADMIN global con los cuatro inventarios QA abiertos emitía `AMBIGUOUS`.
El cliente interpretaba ese estado como fallo de usuario, inventario y Maestro,
y el Health Check terminaba bloqueando en cascada la captura C1.

No era una falla de Auth, SQLite, cámara ni almacenamiento local.

### Corrección

- Se añadió una sobrecarga de RPC con `p_inventory_id uuid`. El servidor
  valida que el id elegido esté `ABIERTO` y que el actor tenga `COUNT_C1`; no
  confía en UI ni en almacenamiento local.
- Sin selección y con varios inventarios válidos, el servidor devuelve
  `INVENTORY_SELECTION_REQUIRED`; no devuelve `AMBIGUOUS`.
- El selector C1 conserva sólo una selección previamente verificada y aún
  autorizada, selecciona automáticamente cuando existe una sola asignación y
  no elige arbitrariamente entre varias.
- La selección se revalida online antes de crear el runtime C1. Sin red sólo
  se puede reutilizar el contexto durable server-verified del mismo actor.
- El Health Check ya no participa en la operación normal. No hay navegación,
  banner global, tarjeta ni indicador `REVISAR` derivados de diagnóstico de
  dispositivo; los servicios técnicos sólo quedan disponibles para soporte y
  QA interno.
- C1 evalúa directamente y exclusivamente: sesión/autorización vigente,
  inventario activo autorizado y estado `ABIERTO`. El Maestro SKU no es un
  requisito local: se consulta bajo demanda en backend. SQLite conserva el
  outbox y una caché opcional para el modo offline, pero no es la autoridad
  que decide la apertura online.
- Los mensajes de C1 son funcionales: selección de inventario requerida,
  contexto no disponible o `C1 listo para conteo`; no se presenta un fallo
  técnico como error de usuario/inventario ni se obliga a sincronizar
  planillas.

### Validación de eliminación del gate visible — 2026-11-10

- Se retiraron de la navegación normal la vista `device-status`, el botón
  superior `REVISAR`, el banner `DISPOSITIVO REQUIERE REVISIÓN` y la acción
  `VER DIAGNÓSTICO`.
- `CountingScreen` ahora muestra `C1 · Contexto operativo`, el inventario
  activo y `LISTO PARA CONTEO` cuando existe runtime autorizado. No existe
  botón ni mensaje de sincronización previa de Maestro para abrir C1.
- El límite real de outbox continúa bloqueando sólo una captura que no puede
  persistirse. Auth, RBAC, validación server-side, Maestro y outbox se
  mantienen; la validación de SKU online es puntual y autorizada.
- Pruebas focales locales: **5 archivos / 24 pruebas PASS**, incluidas C1
  readiness, selector multi-inventario, navegación sin indicador de hardware,
  sincronización funcional y capacidad durable.
- Chromium completo: **37/37 PASS**, incluido C1 sin Health Check, layout
  mobile/landscape, conteo offline, C2/C3 ciego y findings.
- Suite cliente completa posterior al cambio: **86 archivos / 484 pruebas
  PASS**.
- `npm run android:qa:debug`: PASS; el APK anterior fue reemplazado por el
  candidato indicado arriba e instalado mediante ADB en
  `com.lockowom.inven3`.

### Validación QA remota

Se aplicaron únicamente las migraciones
`20261110150808_active_inventory_context_selection.sql` y
`20261110154647_normalize_legacy_counting_context_selection.sql` al QA nuevo
`kpsdephjbvkwvazxubtb`. No modificaron filas de inventarios, asignaciones,
capabilities, stock ni ERP.

| Actor / intento | Resultado |
| --- | --- |
| ADMIN global + `null` | `INVENTORY_SELECTION_REQUIRED` |
| ADMIN global + RPC legacy sin parámetro | `INVENTORY_SELECTION_REQUIRED` |
| ADMIN global + inventario QA autorizado | `AUTHORIZED` |
| ADMIN global + UUID forzado no autorizado | `NOT_AUTHORIZED` |
| CONTADOR QA con una sola asignación + `null` | `AUTHORIZED` |

La función nueva mantiene `SECURITY DEFINER`, `search_path` fijo
`public, app_private, pg_temp`, `EXECUTE` sólo para `authenticated` y no para
`anon`.

## C1 bajo demanda — 2026-11-10

La migración QA `20261110181839_c1_on_demand_backend_lookup.sql` introduce
solamente dos RPCs de lectura para el proyecto QA nuevo:

- `c1_lookup_sku(inventory_id, codigo)` devuelve código, descripción y control
  de trazabilidad del SKU solicitado;
- `c1_lookup_traceability(inventory_id, codigo, control_type)` devuelve sólo
  lotes o series del SKU solicitado, sin cantidades de sistema.

Ambas funciones ejecutan validación de actor activo, `COUNT_C1`, scope de
inventario/bodega y estado `ABIERTO` antes de leer. Usan `SECURITY DEFINER`
con `search_path = ''`, objetos calificados y `EXECUTE` revocado de `PUBLIC`,
`anon` y `authenticated` antes de concederlo explícitamente sólo a
`authenticated`. La comprobación anónima del endpoint QA devuelve **401**.

El cliente abre C1 sin hidratar Maestro, stock, partidas, series ni snapshot
completo. Online consulta el SKU a través de estas RPCs; offline permite sólo
SKU previamente disponibles en su caché. Ningún lookup devuelve cantidad
esperada, diferencia ni stock teórico al contador.

### Pruebas locales

- Contexto/Health/selector: **7 archivos, 65 pruebas PASS**.
- Incluye selección múltiple, restauración autorizada, rechazo del id forzado,
  selección única automática, Health no bloqueante y UI de selector C1.
- Suite cliente completa: **186 archivos / 496 pruebas PASS**. Chromium:
  **49/49 PASS**.
- El Docker local no estaba disponible durante esta ejecución, por lo que la
  suite pgTAP local queda pendiente de una reejecución cuando Docker esté
  iniciado. La verificación funcional de la RPC se realizó contra QA mediante
  `SELECT` dentro de transacción revertida.

## Bloqueo reproducible

`C:\Users\crisc\AppData\Local\Android\Sdk\platform-tools\adb.exe devices -l` devuelve una lista vacía. Por lo tanto no hay dispositivo físico autorizado disponible para instalar la APK ni ejecutar login, cámara/scanner, SQLite real, offline, reinicio, outbox, reconexión, C1/C2/C3, findings, lifecycle y matriz negativa.

Para reanudar: conectar y autorizar por USB un dispositivo Android físico, comprobar que aparezca como `device` en `adb devices -l`, y continuar desde instalación de la APK preparada. No usar emulador como sustituto de este gate.

## Inventario QA con fuente RP real — 2026-11-11

La fuente adjunta `STOCK RP_2_.xlsx` se aceptó únicamente porque su contenido
coincide con la fuente canónica `STOCK RP(2).xlsx`: SHA-256
`6b43ab792ca73210888c316c2886d373a7d4b937f22f3b0145ce272c36f54fa3` y
442.498 bytes. El cambio de nombre corresponde al adjunto y queda trazado; no
se reconstruyó, modificó ni incorporó el libro al repositorio.

| Campo | Resultado |
| --- | --- |
| Proyecto remoto | QA nuevo `kpsdephjbvkwvazxubtb` exclusivamente |
| Inventario | `QA-RP-REAL-20260927` |
| UUID | `51d939f6-4dbc-416a-ba8b-1c45d582cba2` |
| Estado | `ABIERTO`, por transición canónica `BORRADOR → PREPARADO → ABIERTO` |
| Maestro | 2.453 SKU únicos |
| Referencia consolidada | 4.630 filas: 1.076 LEGACY, 1.875 PARTIDA y 1.679 SERIAL |
| Seriales | 1.679 únicas, 82 SKU SERIAL |
| Reconciliación de cinco magnitudes | PASS entre las tres hojas, por SKU |
| Auditoría | importes canónicos de Maestro y referencia con actor ADMIN QA, source y SHA registrados |

Los warnings de fuente no se ocultaron ni corrigieron: 20 SKU PARTIDA con
stock positivo sin partida (353 unidades), cuatro SKU sin unidad de medida y
dos vencimientos atípicos (1931/1932). Las partidas inexistentes no se
inventaron; las unidades faltantes quedan nulas porque el contrato de
referencia vigente lo admite y el origen no las provee.

Las 1.876 filas fuente con partida no vacía producen 1.875 referencias
operativas: una de ellas tiene tanto `Stock Total` como `Disponible` en cero y
el contrato actual sólo materializa referencias con saldo/presencia. No se
perdió ni alteró una partida con stock.

Validación remota del flujo C1 con el ADMIN QA: estado `AUTHORIZED`, capability
`COUNT_C1`, SKU `0AD46651050S` encontrado y 133 series devueltas por el lookup
estrecho; un SKU inexistente devuelve cero filas. Los SKU de prueba ADE,
Yuwell, Cureta, Oxímetro y Cinta Métrica existen con su tipo real y las
referencias conocidas de serie/partida están presentes. Ninguna operación
contactó producción, QA histórico, Softland/ERP ni modificó stock externo.

La certificación Android limpia con este inventario queda pendiente porque,
al término de la importación, `adb devices -l` devolvió cero dispositivos.
La siguiente prueba física debe abrir C1, seleccionar este inventario y
escanear `0AD46651050S` sin Maestro SQLite previo.
