# F11 — Conciliación de Inventario por Analista

Estado: desarrollo en `feature/f11-analyst-reconciliation` / PR #12.
Producción: **LOCKED**.
Aplicación de migraciones a INVEN3-QA remoto: **NO autorizada en este bloque**.

## 1. Objetivo

F11 convierte las diferencias entre la referencia de sistema RP/Softland y el conteo físico recibido por INVEN3 en casos de conciliación trazables.

Una diferencia es un hallazgo a investigar:

- no presume error del contador;
- no genera ajuste de stock;
- no modifica ERP;
- no resuelve automáticamente diferencias;
- conserva evidencia física, referencia de sistema, reconteos y dictamen.

## 2. Fuente de sistema

La referencia de sistema se importa desde el libro RP completo en formato XLSX.

Hojas obligatorias:

1. `STOCK TOTAL`
2. `STOCK CON P`
3. `STOCK CON S`

Uso:

- LEGACY: referencia desde `STOCK TOTAL`;
- PARTIDA: lote/talla desde `STOCK CON P`;
- SERIAL: serie desde `STOCK CON S`.

### Regla de base conciliable: `Disponible`

Para conciliación física, la única cantidad de sistema que puede compararse contra el conteo es la columna **`Disponible`** de Softland/RP.

- `Reserva`, `Transitoria` y `Consignación` se validan como evidencia de la ecuación fuente, pero no se suman al conteo físico.
- `Stock Total` se conserva como trazabilidad de importación y para validar que el libro RP sea consistente; nunca es baseline conciliable.
- Un lote/serie que exista solo en un estado distinto de `Disponible` no se convierte en stock conciliable ni se envía como ajuste a Softland.
- Una diferencia o un lote/serie detectado por INVEN3 es un hallazgo de investigación, no una instrucción de alta ni un ajuste automático de ERP.

Esto evita que un lote transitorio contado físicamente se trate como una unidad nueva al exportar o revisar resultados, evitando duplicidades y ajustes manuales innecesarios.

El parser conserva texto formateado para códigos, lotes y series, incluyendo ceros iniciales.
También conserva `Cod. U. Medida` y, para partidas, `Fecha Venc` normalizada para la lectura operativa.

Bloqueos de importación incluyen, entre otros:

- hoja o columna requerida ausente;
- universo SKU no conciliado entre hojas;
- ecuación de stock inconsistente;
- stock total negativo;
- PARTIDA con stock positivo sin `Partida / Talla`;
- serie en SKU no SERIAL;
- serie sin cantidad exacta 1;
- serie duplicada;
- referencia natural duplicada.

Los estados de stock negativos se reportan como warning cuando la ecuación del total sigue cuadrando.

## 3. Snapshot versionado

Tablas:

- `inventory_system_reference_metadata`
- `inventory_system_reference_items`

Cada snapshot conserva:

- versión;
- filas;
- fuente;
- identificador de importación;
- SHA/fingerprint;
- usuario importador;
- fecha de importación.

La referencia masiva solo puede reemplazarse en inventarios `BORRADOR` o `PREPARADO`.

Después de abrir el inventario no se reemplaza el snapshot de sistema.

## 4. Materialización de hallazgos

RPC:

`materialize_reconciliation_cases(inventory_id)`

Precondiciones:

- actor activo;
- permiso de gestión del inventario;
- inventario en estado `ABIERTO`;
- snapshot de sistema existente.

La materialización compara el snapshot activo con `count_records`.
El snapshot usa exclusivamente `Disponible` como cantidad sistema; `Stock Total` queda fuera de toda clasificación de diferencia.

Tipos de anomalía:

- `SERIE_FISICA_NO_EN_SISTEMA`
- `SERIE_SISTEMA_NO_CONTADA`
- `PARTIDA_FISICA_NO_EN_SISTEMA`
- `PARTIDA_SISTEMA_NO_CONTADA`
- `DIFERENCIA_CANTIDAD_PARTIDA`
- `DIFERENCIA_CANTIDAD_SKU`
- `DUPLICADO_SERIE`

La operación es idempotente para un mismo fingerprint: repetirla no duplica casos abiertos.

C1 se ancla al primer conteo aceptado según:

`received_at → captured_at → created_at → id`

## 5. Máquina de estados

Flujo principal:

`PENDIENTE_ANALISIS`
→ `2DO_CONTEO_ASIGNADO`
→ `FISICO_CONFIRMADO`

Si C1 y C2 difieren:

`2DO_CONTEO_ASIGNADO`
→ `REQUIERE_3ER_CONTEO`
→ `3ER_CONTEO_ASIGNADO`
→ `FISICO_CONFIRMADO`

Cierre:

`FISICO_CONFIRMADO`
→ `RESUELTO`

El cierre exige:

- actor ANALISTA;
- dictamen;
- motivo obligatorio.

## 6. Roles

### CONTADOR

Puede:

- recibir únicamente sus asignaciones de reconteo;
- ejecutar C2 si fue asignado;
- registrar el conteo mediante el flujo normal de `sync_counts`;
- vincular su `client_count_id` al caso mediante el bridge F11.

No puede:

- leer `reconciliation_cases`;
- ver cantidades C1/sistema desde el flujo de reconteo;
- ver timeline;
- ver resumen de conciliación;
- resolver casos.

C2 debe ser un CONTADOR distinto de C1.

### ANALISTA

Puede:

- ver y gestionar casos;
- asignar C2;
- asignar C3;
- ejecutar C3 cuando fue asignado;
- ver timeline;
- ver KPI;
- resolver casos con dictamen y motivo.

C3 siempre debe ser realizado por ANALISTA.

### ADMIN

Puede:

- ver y gestionar casos;
- asignar C2;
- asignar un ANALISTA a C3;
- ver timeline;
- ver KPI.

No puede:

- ejecutar C3 como sustituto de ANALISTA;
- resolver el dictamen final.

## 7. Reconteo ciego

`get_my_recount_assignments` devuelve únicamente:

- id del caso;
- inventario;
- código;
- tipo de control;
- referencia;
- ronda.

No devuelve:

- cantidad C1;
- cantidad sistema;
- diferencia;
- dictamen.

La tabla `reconciliation_cases` permanece oculta para CONTADOR mediante RLS.

## 8. Invariantes de reconteo

C2:

- actor asignado;
- distinto de C1;
- CONTADOR activo y asignado;
- mismo SKU;
- misma serie/lote cuando aplica;
- observación física real en `count_records`;
- un `count_record` no se reutiliza en otro caso.

C3:

- actor exactamente asignado;
- rol ANALISTA;
- mismo SKU;
- misma serie/lote;
- observación física distinta de C1/C2;
- no reutilización entre casos.

Si C1 = C2, se confirma físico.

Si C1 ≠ C2, se exige C3.

## 9. Dictamen

Valores actuales:

- `SIN_AJUSTE`
- `AJUSTE_PROPUESTO`
- `ERROR_DIGITACION_CONFIRMADO`
- `ALTA_EN_SISTEMA_PROPUESTA`
- `BAJA_EN_SISTEMA_PROPUESTA`
- `OTRO`

`AJUSTE_PROPUESTO` es un dictamen documental; F11 no ejecuta ajustes de inventario.

## 10. Ledger inmutable

Tabla:

`reconciliation_events`

Eventos:

- `SECOND_ASSIGNED`
- `SECOND_RECORDED`
- `THIRD_ASSIGNED`
- `THIRD_RECORDED`
- `RESOLVED`

El cliente autenticado no puede insertar, actualizar ni borrar eventos directamente.

La escritura ocurre dentro de los RPC de negocio y en la misma transacción.

El Centro de Conciliación muestra timeline por caso con:

- evento;
- actor;
- fecha;
- destinatario de asignación cuando aplica;
- resultado C2/C3;
- dictamen y motivo final.

## 11. KPI operativo

RPC:

`get_reconciliation_summary(inventory_id)`

El resumen usa exclusivamente el fingerprint RP activo.

Métricas:

- casos abiertos;
- pendiente de análisis;
- segundo conteo;
- tercer conteo;
- físico confirmado;
- resueltos;
- breakdown por anomalía.

No mezcla casos pertenecientes a snapshots RP distintos.

CONTADOR no tiene acceso.

## 11.1 Vista operativa en vivo

RPC:

`get_live_reconciliation_workspace(inventory_id, search, status, limit)`

La vista de ANALISTA/ADMIN presenta SKU, producto, unidad de medida, partida/serie, vencimiento, `Disponible`, conteo físico, diferencia y estado (`CUADRADO`, `DIFERENCIA`, `NUEVO_LOTE_SERIE`, `FUERA_DE_DISPONIBLE` o `VENCIMIENTO_DISTINTO`). `FUERA_DE_DISPONIBLE` identifica una partida/serie que sí existe en la fuente, pero únicamente en reserva/transitorio/consignación: nunca se trata como alta ni lote nuevo. Se refresca como lectura operacional; no ejecuta cambios sobre Softland ni sobre stock de sistema.

CONTADOR no puede consultar esta vista ni sus cantidades mediante UI, RLS o RPC.

## 12. Seguridad

Los RPC privilegiados usan `SECURITY DEFINER` con `search_path` restringido y privilegios explícitos.

Principios:

- autenticación activa obligatoria;
- RLS en tablas expuestas;
- acceso de lectura según inventario;
- DML directo revocado donde corresponde;
- funciones internas sin EXECUTE para cliente;
- fail closed ante actor, estado, referencia o conteo inválido.

## 13. Flujo operativo recomendado

1. Crear inventario.
2. Importar Maestro SKU.
3. Importar referencia RP.
4. Revisar preview y errores.
5. Preparar inventario.
6. Abrir inventario.
7. Ejecutar conteo físico.
8. Sincronizar pendientes.
9. Generar/actualizar hallazgos.
10. Analizar caso.
11. Asignar C2 a un contador distinto de C1.
12. Si coincide, confirmar físico.
13. Si difiere, asignar C3 a ANALISTA.
14. Registrar C3.
15. Analista emite dictamen con motivo.
16. Caso pasa a `RESUELTO`.
17. Cualquier ajuste real de ERP/stock se ejecuta por un proceso externo autorizado, no por F11.

## 14. Certificación

La suite F11 cubre:

- RLS;
- privilegios RPC;
- reconteo adversarial;
- C2 distinto de C1;
- C3 ANALISTA;
- exactitud SERIAL/PARTIDA;
- no reutilización de `count_record`;
- ledger;
- timeline manager-only;
- parser RP;
- materialización;
- idempotencia;
- duplicado de serie;
- cronología C1;
- KPI fingerprint activo;
- UI de asignación;
- UI de referencia RP;
- UI de timeline;
- superficies ADMIN / ANALISTA / CONTADOR.

Comandos canónicos:

```bash
npm run lint
npm run typecheck
npm run test
npx supabase db reset
npx supabase test db --local supabase/tests
npm run test:e2e
npm run test:visual
npm run test:ios:virtual
```

## 15. Límite de despliegue actual

El desarrollo GitHub de F11 está autorizado.

No se debe, sin autorización explícita adicional:

- aplicar estas migraciones al proyecto Supabase QA remoto;
- tocar producción;
- modificar el candidato congelado F10A;
- habilitar F10B;
- cargar datos RP reales en QA.

El PR F11 no se fusiona automáticamente.
