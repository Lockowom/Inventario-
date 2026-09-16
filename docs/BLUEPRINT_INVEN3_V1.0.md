# BLUEPRINT TÉCNICO Y FUNCIONAL — INVEN3 v1.0

**Proyecto:** INVEN3  
**Versión:** 1.0  
**Fecha base:** 16-09-2026  
**Estado:** BASELINE FUNCIONAL APROBADA / LISTO PARA DISEÑO FÍSICO E IMPLEMENTACIÓN

## 1. Objetivo

INVEN3 será una aplicación especializada en captura de inventario físico.

Su flujo principal será:

`CAPTURAR → VALIDAR → CONSERVAR → SINCRONIZAR → CORTAR → EXPORTAR`

INVEN3 no modificará automáticamente el stock oficial de Softland/RP. RP seguirá siendo la fuente oficial del stock de sistema. INVEN3 será la fuente oficial de conteos físicos, ubicación, lotes, series, vencimientos, cantidades, correcciones, cortes, rectificaciones y auditoría.

### Conteo ciego

Durante el conteo físico el usuario no verá stock RP/Softland, diferencias, faltantes, sobrantes, valorización ni conciliación.

---

## 2. Arquitectura general

```text
                         GITHUB
                           │
                     React + Vite
                           │
            ┌──────────────┴──────────────┐
            │                             │
      APLICACIÓN MÓVIL                WEB INVEN3
        Capacitor 8                Cloudflare Pages
            │                             │
     ┌──────┴──────┐                      │
     │             │                      │
 Android         iOS                      │
     │             │                      │
 SQLite         SQLite               IndexedDB
  local          local                 / Dexie
     │             │                      │
     └─────────────┴──────────┬───────────┘
                              │
                         SYNC ENGINE
                              │
                        API / RPC SEGURA
                              │
                        SUPABASE FREE
                         PostgreSQL
                              │
       ┌──────────────────────┼───────────────────────┐
       │                      │                       │
    CONTEOS                 CORTES                AUDITORÍA
       │                      │
       │                    SNAPSHOT
       │                      │
       └──────────────────────┴──────────────┐
                                             │
                                      GENERADOR XLSX
                                             │
                                      ARCHIVO PARA RP
```

---

## 3. Stack tecnológico

### Frontend
- React.
- TypeScript.
- Vite.
- React Router.
- TanStack Query.
- Zustand o equivalente para estado local pequeño.
- Zod o equivalente para contratos y validaciones.

### Móvil
- Capacitor 8.
- Android + iOS desde el mismo proyecto.
- Aplicación instalada localmente; no dependerá de Chrome, Safari ni de una URL remota para iniciar.

### Base local móvil
- SQLite nativo.
- El plugin exacto se valida por prueba de concepto Android/iOS antes de fijarlo.

### Base central
- Supabase Free.
- PostgreSQL.
- Supabase Auth.
- RLS.
- RPC/Functions protegidas.

### Web
- Cloudflare Pages para frontend estático.
- La lógica crítica permanecerá en Supabase/PostgreSQL.

### Repositorio oficial
- `Lockowom/Inventario-`

---

## 4. Estructura propuesta del repositorio

```text
INVEN3/
│
├── src/
│   ├── app/
│   ├── components/
│   ├── design-system/
│   ├── domain/
│   │   ├── inventory/
│   │   ├── count/
│   │   ├── cut/
│   │   ├── sync/
│   │   └── validation/
│   ├── features/
│   │   ├── auth/
│   │   ├── counting/
│   │   ├── my-counts/
│   │   ├── monitoring/
│   │   ├── cuts/
│   │   ├── rectifications/
│   │   └── administration/
│   ├── storage/
│   │   ├── mobile-sqlite/
│   │   └── web-indexeddb/
│   ├── scanner/
│   ├── sync/
│   ├── services/
│   └── hooks/
├── android/
├── ios/
├── supabase/
│   ├── migrations/
│   ├── functions/
│   ├── policies/
│   └── seed/
├── tests/
│   ├── unit/
│   ├── integration/
│   ├── e2e/
│   ├── visual/
│   └── load/
├── docs/
├── scripts/
├── capacitor.config.ts
├── package.json
└── .github/workflows/
```

---

## 5. Roles

### CONTADOR
Puede:
- contar;
- escanear;
- trabajar offline;
- consultar sus propios conteos;
- buscar sus registros;
- corregir sus registros antes de un corte.

No puede:
- hacer cortes;
- rectificar cortes;
- modificar registros ya cortados;
- administrar maestros;
- cerrar/congelar inventarios.

### ANALISTA
Puede:
- visualizar todos los usuarios;
- monitorear conteos;
- buscar registros;
- revisar errores;
- hacer cortes;
- descargar cortes;
- realizar rectificaciones;
- resolver códigos excepcionales;
- gestionar el proceso operativo.

### ADMIN
Incluye funciones del Analista más:
- crear inventarios;
- usuarios;
- permisos;
- maestros;
- configuraciones;
- parámetros técnicos.

---

## 6. Ciclo de vida del inventario

```text
BORRADOR
   ↓
PREPARADO
   ↓
ABIERTO
   ↓
CERRADO
   ↓
CONGELADO
```

### BORRADOR
Preparación de nombre, usuarios, maestro SKU y configuración. No permite contar.

### PREPARADO
Todo validado y listo para descarga offline. Todavía no permite contar.

### ABIERTO
Conteo habilitado.

### CERRADO
No se aceptan nuevos conteos normales. Los registros offline previamente creados pueden terminar su sincronización.

### CONGELADO
Inventario finalizado. Solo consulta, auditoría, histórico, cortes y rectificaciones autorizadas.

**Regla obligatoria:** no puede pasar a CONGELADO mientras existan pendientes conocidos de sincronización.

---

## 7. Maestro SKU

Cada inventario posee su propio snapshot.

Campos mínimos:
- `CODIGO`
- `DESCRIPCION`

Reglas:
- CODIGO obligatorio, texto, mayúsculas, conserva ceros iniciales y es único.
- DESCRIPCION obligatoria.
- El maestro queda congelado al abrir el inventario.
- Se descarga a cada dispositivo para trabajo offline.

Clasificación automática:
- termina en `S` → SERIAL.
- termina en `P` → PARTIDA.
- otro → LEGACY.

SKU no encontrado:

> Código no encontrado en el maestro del inventario. Verifique el código. Si el producto existe físicamente y no aparece en el sistema, diríjase al Analista de Inventario.

Solo Analista/Admin puede resolver la excepción y debe quedar auditada.

---

## 8. Contrato oficial de captura

Orden obligatorio del formulario:

1. UBICACION
2. CODIGO
3. SERIE
4. PARTIDA
5. PIEZA DEL PRODUCTO
6. FECHA DE VENCIMIENTO
7. Talla del producto
8. Color del Producto
9. Cantidad Contada
10. DESCRIPCION

Contrato Excel operacional A:J:

| Columna | Campo |
|---|---|
| A | UBICACION |
| B | CODIGO |
| C | SERIE |
| D | PARTIDA |
| E | PIEZA DEL PRODUCTO |
| F | FECHA DE VENCIMIENTO |
| G | Talla del producto |
| H | Color del Producto |
| I | Cantidad Contada |
| J | DESCRIPCION |

No se insertarán columnas técnicas entre A:J.

---

## 9. UBICACION

Obligatoria y en mayúsculas.

Pasillos permitidos:
- A
- B
- C
- C2
- D
- F
- G
- H
- I

Regex contractual:

```regex
^(A|B|C|C2|D|F|G|H|I)-[0-9]{2}-[0-9]{2}$
```

Ejemplos válidos:
- A-01-01
- F-32-03
- I-05-02
- C2-15-03

Ejemplos inválidos:
- F-3-03
- F-32-3
- F3203
- E-32-03
- C3-32-03
- C2-3-03

Mensaje:

> Ubicación mal digitada. Verifique el formato y el pasillo. Ejemplos válidos: F-32-03 o C2-32-03.

---

## 10. CODIGO

Obligatorio.

- Texto.
- Mayúsculas.
- Conserva ceros iniciales.
- Debe existir en maestro.

Si falla:

> Código mal ingresado.

Al reconocerlo:
- carga descripción;
- determina tipo de control.

---

## 11. SKU terminado en S

Producto serializado.

Reglas:
- SERIE obligatoria.
- PARTIDA deshabilitada.
- Cantidad = 1 automática y no editable.

Si falta serie:

> Favor introducir la serie. Si el producto no está etiquetado o no tiene una serie visible, favor hablar con el Analista de Inventario.

SERIE:
- texto;
- máximo 19 caracteres.

Si supera 19:

> La serie ingresada supera el máximo permitido de 19 caracteres. Diríjase al Analista de Inventario con el producto para su revisión.

---

## 12. SKU terminado en P

Producto controlado por partida.

Reglas:
- PARTIDA obligatoria.
- SERIE deshabilitada.

Si falta:

> Favor introducir el lote/partida. Si el producto no está etiquetado o no tiene un lote visible, favor hablar con el Analista de Inventario.

PARTIDA siempre se trata como texto.

Ejemplo:
- `00725` debe permanecer `00725`, nunca convertirse en `725`.

---

## 13. SKU LEGACY

Código que no termina en P ni S.

SERIE y PARTIDA son opcionales.

Puede ingresar una, ambas o ninguna.

---

## 14. PIEZA DEL PRODUCTO

Opcional.
Sin restricción específica adicional.
Se trata como texto en exportaciones.

---

## 15. FECHA DE VENCIMIENTO

Captura mediante calendario.

Almacenamiento interno:

`YYYY-MM-DD`

Ejemplo:

`2027-04-10`

No almacenar fechas ambiguas como texto visual.

---

## 16. TALLA Y COLOR

Opcionales.
Sin restricciones especiales.
Tratados como texto.

---

## 17. CANTIDAD CONTADA

Obligatoria.
Solo entero positivo.
Mínimo 1.

No acepta:
- 0
- negativos
- decimales
- signos
- texto

Mensaje para cero:

> La cantidad contada debe ser mayor a 0. Ingrese al menos 1 unidad.

Para serial: cantidad = 1 automática y bloqueada.

---

## 18. DESCRIPCION

Read-only para SKU reconocido.
Se obtiene desde el maestro.
No utilizar fórmulas Excel como fuente de descripción.

---

## 19. Escáner

Campos escaneables:
- UBICACION
- CODIGO
- SERIE
- PARTIDA

Mínimo:
- QR;
- Code 128;
- GS1-128/EAN-128 cuando sea reconocible por scanner;
- cámara trasera;
- linterna cuando el dispositivo la soporte.

Escanear no guarda automáticamente.

Flujo:

`ESCANEAR → llenar campo → normalizar → validar → GUARDAR`

---

## 20. Funcionamiento offline

INVEN3 es offline-first.

Guardar un conteo no depende de Internet.

Flujo móvil:

`GUARDAR → validación local → transacción SQLite → confirmación → Sync Engine → servidor`

La confirmación visual solo aparece después de que SQLite confirme la escritura local.

---

## 21. Límite offline

Máximo 50 registros de conteo pendientes por dispositivo.

Umbrales:
- 40/50 → advertencia.
- 45/50 → advertencia crítica.
- 50/50 → bloquear nuevas capturas offline.

Nunca se eliminan pendientes para liberar espacio.

---

## 22. Datos requeridos offline

Antes de trabajar offline deben existir localmente:
- inventario activo;
- usuario;
- maestro SKU;
- configuración;
- reglas de ubicación;
- datos mínimos necesarios.

La app solo mostrará `LISTO PARA TRABAJAR OFFLINE` después de validar estos recursos.

---

## 23. Identificador único del conteo

Cada conteo obtiene localmente:

`client_count_id = UUID`

En PostgreSQL:

`client_count_id UNIQUE`

Reenviar el mismo UUID varias veces debe producir un solo registro final.

---

## 24. Tiempos

Registrar separadamente:
- `captured_at`
- `received_at`

`captured_at`: momento del conteo físico.
`received_at`: momento en que el servidor lo recibe.

---

## 25. Motor de sincronización

No depender únicamente de `navigator.onLine`.

Características:
- comprobación real de backend;
- batches controlados;
- máximo inicial sugerido 20 por solicitud;
- backoff exponencial;
- jitter;
- reintentos;
- resultado individual por registro;
- idempotencia.

50 pendientes se procesan inicialmente como 20 + 20 + 10.

---

## 26. Estados locales del conteo

- LOCAL
- PENDING
- SYNCING
- CONFIRMED
- FAILED
- REJECTED

Nunca se elimina un pendiente sin confirmación inequívoca del backend.

---

## 27. Reconexión masiva

Operación esperada: ~47 usuarios.

Escenario extremo de diseño:

`47 × 50 = 2.350 registros pendientes`

Se utilizarán batching, jitter inicial y reintentos escalonados.

---

## 28. MIS CONTEOS

Cada contador puede consultar todos sus registros de la jornada incluso offline.

Búsqueda por:
- ubicación;
- SKU;
- serie;
- partida.

Debe mostrar:
- ubicación;
- código;
- lote/serie;
- cantidad;
- hora;
- estado de sincronización.

---

## 29. Monitor del Analista

Pantalla `SEGUIMIENTO DE CONTADORES`.

Mostrar:
- usuario;
- estado;
- última ubicación;
- último SKU;
- última serie/partida;
- última cantidad;
- hora;
- conteos realizados;
- pendientes.

Estados:
- ONLINE
- OFFLINE
- SINCRONIZANDO
- ERROR

Si un usuario está offline, solo puede mostrarse el último dato recibido por servidor y debe indicar `Última sincronización conocida`.

---

## 30. Correcciones antes del corte

El contador puede corregir sus propios registros mientras no pertenezcan a un corte.

Nunca se destruye el registro original.

Ejemplo:

```text
V1 Cantidad 15
V2 Cantidad 12
Motivo: error de digitación
```

Motivo obligatorio.
Auditoría conserva anterior, nuevo, usuario, fecha y motivo.

---

## 31. Registro ya cortado

Una vez perteneciente a un corte:
- EDITAR = NO
- ELIMINAR = NO

El registro queda inmutable.

---

## 32. Cortes

Función exclusiva Analista/Admin: `HACER CORTE`.

Cortes correlativos:
- CORTE 001
- CORTE 002
- CORTE 003
- ...

---

## 33. Secuencia de exportación

No depende del ID PostgreSQL ni de fila visual.

Se utilizará `export_seq`.

Ejemplo:

```text
CORTE 001: 1 → 1988
CORTE 002: 1989 → 3846
CORTE 003: 3847 → 4973
```

---

## 34. Selección de un corte

Solo registros válidos con `cut_id IS NULL`.

Un registro con corte asignado nunca puede entrar en otro corte.

---

## 35. Transacción del corte

Conceptualmente:

```text
BEGIN
bloquear creación concurrente
crear corte
seleccionar registros elegibles
asignar cut_id
asignar export_seq
guardar first_export_seq
guardar last_export_seq
crear snapshot
COMMIT
```

Dos clics simultáneos no pueden generar cortes superpuestos.

---

## 36. Registros offline al momento de un corte

Solo se incluyen registros ya sincronizados.

Un registro que sincroniza después del corte no entra retroactivamente; queda disponible para el siguiente.

---

## 37. Estados del corte

- CREATING
- SNAPSHOT_CREATED
- FILE_GENERATED
- VALIDATED
- READY
- ERROR

Si falla la generación Excel después del snapshot, el corte no se deshace. Se regenera desde el mismo snapshot.

---

## 38. Excel del corte para Finanzas/RP

Archivo limpio.

No incluye:
- UBICACION;
- ID;
- UUID;
- usuario;
- timestamp;
- dispositivo;
- sync;
- auditoría.

Columnas exactas:

| Columna | Campo | Tipo |
|---|---|---|
| A | CODIGO | Texto |
| B | SERIE | Texto |
| C | PARTIDA | Texto |
| D | PIEZA DEL PRODUCTO | Texto |
| E | FECHA DE VENCIMIENTO | Fecha Excel |
| F | Talla del producto | Texto |
| G | Color del Producto | Texto |
| H | Cantidad Contada | Entero |
| I | DESCRIPCION | Texto |

No habrá fórmulas.

---

## 39. Protección de ceros iniciales

Los identificadores se escriben explícitamente como texto XLSX.

Ejemplos:
- `00725` → `00725`
- `00001` → `00001`
- `001234` → `001234`

Aplica especialmente a CODIGO, SERIE, PARTIDA y PIEZA.

---

## 40. Fecha Excel

No se exporta como texto.

Debe ser una celda fecha Excel real.

Formato baseline:

`dd-mm-yyyy`

Fecha inexistente = celda realmente vacía.

La compatibilidad final se certificará mediante importación real de prueba en RP.

---

## 41. Validación automática del XLSX

Antes de pasar un corte a READY se valida:
- 9 columnas exactas;
- nombres y orden;
- identificadores como texto;
- ceros iniciales;
- fechas reales;
- cantidades enteras positivas;
- ausencia de fórmulas;
- cantidad de filas = cantidad del snapshot.

---

## 42. Nombre de archivos

Corte:

`INVEN3_INVENTARIO_GENERAL_2026_CORTE_001.xlsx`

Rectificación:

`INVEN3_INVENTARIO_GENERAL_2026_CORTE_004_RECTIFICACION_001.xlsx`

---

## 43. Histórico de cortes

Mostrar:
- corte;
- desde;
- hasta;
- registros;
- fecha;
- usuario;
- estado;
- archivo.

Acciones:
- ver;
- descargar;
- consultar registros.

El archivo original se conserva y no se reemplaza silenciosamente.

---

## 44. Integridad del archivo

Cada XLSX tendrá SHA-256 almacenado con la metadata del corte.

---

## 45. Rectificaciones post-corte

Regla aprobada: rectificación separada.

El corte original nunca se modifica.

Ejemplo:

`CORTE_004_RECTIFICACION_001.xlsx`

Debe guardar:
- corte afectado;
- registro;
- valor anterior;
- valor correcto;
- motivo;
- analista;
- fecha.

---

## 46. Respaldos

Tres capas:

1. SQLite dispositivo.
2. PostgreSQL central.
3. Snapshots/exportaciones.

Después de cada corte:
- snapshot;
- XLSX RP;
- metadata;
- hash;
- respaldo técnico.

Al congelar:
- respaldo completo final.

---

## 47. Health Check del dispositivo

Antes de jornada validar:
- versión de app;
- usuario;
- inventario;
- maestro SKU;
- SQLite;
- cámara;
- permisos;
- scanner;
- almacenamiento;
- conectividad backend;
- hora del dispositivo.

Resultado: `DISPOSITIVO LISTO PARA INVENTARIO` o detalle del problema.

---

## 48. Compatibilidad de pantalla

Diseño por dimensiones, no por marca/modelo.

Rangos:
- 320–359: compacto.
- 360–419: móvil estándar.
- 420–599: móvil amplio.
- 600–899: tablet.
- 900+: desktop.

---

## 49. Responsive

Móvil angosto: una columna.
Pantallas amplias: dos columnas cuando aporte valor.

Nunca comprimir varios controles para mantener artificialmente una fila.

---

## 50. Reglas visuales obligatorias

En pantallas operacionales:
- scroll horizontal prohibido;
- safe areas iOS;
- notch/Dynamic Island;
- barra gestual;
- teclado;
- orientación;
- fuentes grandes;
- descripciones largas;
- botones táctiles suficientemente grandes.

Ningún botón principal puede quedar oculto por el teclado.

---

## 51. Sistema de diseño

Tokens centrales:
- spacing;
- radius;
- typography;
- control-height;
- button-height;
- touch-target;
- breakpoints;
- safe-area.

No permitir tamaños arbitrarios por componente.

---

## 52. Cámara iOS / Android

Compatibilidad certificada por separado en dispositivos reales.

Pruebas mínimas en ambos:
- permiso;
- abrir;
- QR;
- Code128;
- flash;
- cancelar;
- volver al formulario.

---

## 53. GitHub y CI/CD

Branch principal: `main`.

Recomendado:
- `feature/*`
- `fix/*`
- `release/*`

Pipeline mínimo:
- lint;
- typecheck;
- unit tests;
- integration tests;
- build.

---

## 54. Build Android

Flujo:

```text
npm ci
npm run build
npx cap sync android
Gradle
APK/AAB
```

---

## 55. Build iOS

Debe existir desde el inicio.

Flujo:

```text
React build
↓
cap sync ios
↓
Xcode build
↓
firma
↓
artefacto iOS
```

La distribución formal iOS está sujeta a las reglas externas de Apple.

---

## 56. OTA

Flujo objetivo:

```text
GitHub
↓
bundle
↓
SHA-256
↓
GitHub Release
↓
BETA
↓
validación
↓
PRODUCTION
```

Nunca liberar automáticamente a todos los dispositivos.

Cambios nativos requieren nueva APK/app iOS. OTA solo reemplaza JS, CSS y assets web.

---

## 57. Seguridad

Nunca incluir `SUPABASE_SERVICE_ROLE_KEY` en web, Android o iOS.

Cliente:
- clave pública correspondiente;
- sesión de usuario.

Acciones sensibles:
- RPC/Function protegida;
- autorización servidor;
- validación rol;
- auditoría.

---

## 58. RLS

Todas las tablas sensibles tendrán RLS.

CONTADOR: ve lo necesario y sus propios conteos.
ANALISTA: acceso operacional ampliado.
ADMIN: administración.

No confiar solo en ocultar botones frontend.

---

## 59. Funciones críticas solo servidor

Ejemplos:
- `create_cut()`
- `rectify_cut()`
- `close_inventory()`
- `freeze_inventory()`
- `add_master_exception()`
- `sync_counts()`

El frontend no ejecutará secuencias críticas mediante múltiples INSERT/UPDATE independientes.

---

## 60. Modelo lógico de datos

Entidades principales:
- `inventory_events`
- `inventory_master_items`
- `profiles`
- `inventory_assignments`
- `count_records`
- `count_revisions`
- `sync_devices`
- `inventory_cuts`
- `inventory_cut_items`
- `cut_rectifications`
- `audit_events`
- `generated_files`

---

## 61. count_records — campos base

Conceptualmente:

```text
id
client_count_id
inventory_id
user_id
ubicacion
codigo
serie
partida
pieza_producto
fecha_vencimiento
talla
color
cantidad_contada
descripcion
captured_at
received_at
device_id
status
cut_id
export_seq
created_at
updated_at
```

`client_count_id` debe ser UNIQUE.

---

## 62. Auditoría

Eventos mínimos:
- COUNT_CREATED
- COUNT_SYNCED
- COUNT_CORRECTED
- COUNT_REJECTED
- CUT_CREATED
- CUT_FILE_GENERATED
- CUT_DOWNLOADED
- RECTIFICATION_CREATED
- INVENTORY_OPENED
- INVENTORY_CLOSED
- INVENTORY_FROZEN
- MASTER_IMPORTED
- MASTER_EXCEPTION_ADDED

Auditoría append-only.

---

## 63. Observabilidad

Indicadores mínimos:
- conteos recibidos;
- pendientes;
- rechazados;
- sync errors;
- último sync por dispositivo;
- versión instalada;
- último corte;
- registros disponibles para corte.

Cada batch tendrá `sync_batch_id`.

---

## 64. Pruebas obligatorias

### Concurrencia
- 47 usuarios simultáneos.
- 100 usuarios simulados.

### Reconexión
- 47 × 50 = 2.350 pendientes.

### Idempotencia
- mismo UUID reenviado → un solo registro final.

### Offline
- cerrar app;
- reabrir;
- reiniciar dispositivo;
- cambiar conexión;
- perder red durante sync.

### Cortes
- mínimo 7 cortes consecutivos.
- 0 solapamientos.
- 0 duplicados técnicos.
- 0 registros perdidos.

### Excel
Validar lotes como:
- 00725
- 00001
- 001234

y fechas reales de Excel.

---

## 65. Certificación

Una versión no puede convertirse en `PRODUCTION INVENTORY` si falla una prueba crítica.

Criterios:
- pérdida de conteos = 0;
- duplicados técnicos = 0;
- solapamientos = 0;
- lotes alterados = 0;
- errores de fecha RP = 0;
- corrupción de cola offline = 0.

---

## 66. Objetivos iniciales de rendimiento

- guardar SQLite local: < 300 ms normalmente;
- buscar SKU local: < 300 ms;
- abrir formulario: < 1 s en dispositivo objetivo;
- sincronización nunca bloquea captura.

No se exige que 2.350 registros sincronicen instantáneamente; sí que los usuarios puedan seguir trabajando.

---

## 67. Pruebas visuales

Viewports mínimos:
- 320
- 360
- 390
- 412
- 430
- 768
- 1024
- 1440

Regresión visual con Playwright o equivalente.

Debe detectar:
- botones fuera de pantalla;
- campos superpuestos;
- texto cortado;
- overflow horizontal;
- componentes rotos.

---

## 68. Matriz física de dispositivos

Antes de producción probar al menos:
- Android angosto;
- Android estándar;
- Android grande;
- Android alta densidad;
- iPhone compacto;
- iPhone estándar;
- iPhone grande;
- tablet Android;
- iPad.

No solo emuladores.

---

## 69. Web

La versión web compartirá dominio, reglas, validaciones, API y roles.

Offline web:
- IndexedDB/Dexie.

Móvil:
- SQLite.

Las reglas de negocio deben residir en una capa común.

---

## 70. Cloudflare Pages

Uso:
- frontend estático;
- web Analista/Admin;
- previews;
- producción web.

No depender de funciones server-side de Pages para lógica crítica.

---

## 71. Lo que INVEN3 no debe hacer

No debe:
- modificar automáticamente Softland;
- mostrar stock RP durante conteo;
- utilizar Sheets como DB;
- utilizar Apps Script como persistencia;
- depender de Excel para conservar conteos;
- perder conteos por falta de Internet;
- sobrescribir registros históricos;
- reutilizar registros en dos cortes;
- transformar lotes eliminando ceros;
- exportar fechas como texto;
- incluir columnas técnicas en Excel RP.

---

## 72. Fases de implementación

### FASE 0 — Fundación
- repo GitHub;
- TypeScript;
- Vite;
- Capacitor Android/iOS;
- Supabase;
- CI;
- Cloudflare Pages;
- design system.

### FASE 1 — Modelo y seguridad
- schema PostgreSQL;
- migraciones;
- RLS;
- Auth;
- roles;
- inventarios.

### FASE 2 — Maestro
- carga;
- validación;
- snapshot;
- distribución offline.

### FASE 3 — Conteo
- formulario;
- reglas;
- scanner;
- SQLite;
- Mis Conteos.

### FASE 4 — Sync
- UUID;
- batches;
- retries;
- jitter;
- monitor.

### FASE 5 — Supervisión
- seguimiento usuarios;
- búsqueda;
- correcciones;
- auditoría.

### FASE 6 — Cortes
- secuencia;
- transacción;
- snapshots;
- histórico.

### FASE 7 — Excel
- XLSX;
- tipado;
- fechas;
- ceros;
- SHA-256;
- prueba RP.

### FASE 8 — Rectificaciones y backups
- rectificaciones;
- snapshots;
- recuperación.

### FASE 9 — Certificación
- carga;
- offline;
- dispositivos;
- visual;
- RP;
- beta.

### FASE 10 — Producción
- release;
- rollout beta;
- promoción;
- Inventario General.

---

## 73. Regla de desarrollo

No se agregará funcionalidad nueva porque “sería útil” si altera contratos, tablas, flujo o reglas sin revisión previa.

Clasificación de cambios:
- BUG
- MEJORA TÉCNICA SIN CAMBIO FUNCIONAL
- CAMBIO FUNCIONAL

Un cambio funcional requiere actualizar este Blueprint.

---

## 74. Definición de terminado

INVEN3 v1.0 estará terminado cuando:
- Android funciona;
- iOS funciona;
- web funciona;
- captura cumple A:J;
- scanner funciona;
- offline funciona;
- 50 pendientes sobreviven;
- 2.350 se sincronizan sin pérdida;
- 47 usuarios pueden trabajar;
- monitor funciona;
- correcciones funcionan;
- cortes funcionan;
- 7+ cortes no se solapan;
- Excel sale limpio;
- `00725` permanece `00725`;
- fechas RP son válidas;
- rectificaciones funcionan;
- snapshots funcionan;
- auditoría funciona;
- layout pasa matriz de dispositivos;
- versión pasa certificación.

---

## 75. Decisiones funcionales cerradas

- Conteo ciego.
- Maestro por inventario.
- SKU desconocido bloqueado.
- P/S/Legacy.
- A:J oficial.
- Ubicación estricta.
- Cantidad > 0.
- Serial = 1.
- Máximo 19 caracteres serie.
- QR/Code128.
- Offline 50.
- 47 usuarios.
- Diseño para 100 concurrentes.
- SQLite móvil.
- Supabase PostgreSQL.
- GitHub.
- Capacitor.
- Android + iOS.
- Cloudflare Pages.
- Corrección propia antes del corte.
- Monitor por usuario.
- Corte automático.
- Sin duplicado entre cortes.
- Excel sin UBICACION.
- Ceros iniciales protegidos.
- Fecha Excel real.
- Rectificación separada.
- Snapshots por corte.
- No congelar con pendientes.
- Certificación obligatoria.
- Responsive multiplataforma.

---

## 76. Decisiones de implementación aún validables

Pueden cambiar de librería sin alterar el funcionamiento:
1. plugin SQLite exacto;
2. librería XLSX exacta;
3. librería UI;
4. herramienta de load testing;
5. implementación exacta de OTA iOS;
6. estrategia final de distribución empresarial iOS.

---

## 77. Duplicado técnico vs. posible duplicado físico

Duplicado técnico:

`mismo client_count_id`

Debe bloquearse automáticamente.

El mismo SKU puede existir legítimamente en distintas ubicaciones, por lo que no se bloquea un SKU simplemente por haber aparecido antes.

La detección avanzada de posibles duplicados físicos —por ejemplo, misma serie del mismo SKU contabilizada dos veces— se implementará con una regla específica y auditada.

---

## 78. Principio final

Prioridades:

1. NO PERDER DATOS.
2. NO DUPLICAR DATOS.
3. TRAZABILIDAD.
4. EXACTITUD RP.
5. FUNCIONAMIENTO OFFLINE.
6. VELOCIDAD DE CAPTURA.
7. EXPERIENCIA VISUAL.

El sistema deberá poder demostrar, para cualquier fila exportada:
- qué se contó;
- dónde;
- cuándo;
- quién;
- en qué dispositivo;
- qué versión quedó vigente;
- en qué corte salió;
- qué archivo fue entregado;

sin introducir esos datos técnicos dentro del Excel limpio utilizado por Finanzas/RP.

---

**FIN — BLUEPRINT INVEN3 v1.0**
