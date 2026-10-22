# CUT2-09B3 — Validación local

## Bugs corregidos

1. Eligibility comparaba estados de recuento inexistentes (`CLAIMED`, `HELD`).
   La fuente canónica sólo permite `QUEUED`, `ACTIVE`, `COMPLETED` y
   `CANCELLED`; RP bloquea los dos primeros.
2. `ORPHAN_REFERENCE` no restringía bodega ni excluía huérfanos resueltos.
3. Un caso UOM abierto no formaba parte de la matriz RP.
4. El writer no bloqueaba las referencias antes de recalcular. Ahora toma
   `FOR UPDATE` sobre toda la selección, cerrando la ventana con inserts C2,
   C3, findings y UOM que tienen FK a la referencia.

## Contratos ejecutados

- Reset local desde cero: PASS.
- `cut2_09_rp_release_core_test.sql`: creación, idempotencia, stale, finding,
  C2 y C3.
- `cut2_09_rp_release_security_blockers_test.sql`: inyección foreign,
  referencia no sellada, UOM, orphan, anon, inmutabilidad y no-ERP.
- `cut2-09-rp-create-race.ps1`: dos clientes Postgres con el mismo request id;
  exactamente un batch y una auditoría.
- `cut2-09-rp-release-concurrency.mjs`: tres carreras con clientes libpq
  independientes y una barrera de locks PostgreSQL: finding, C2 y C3 primero
  invalidan `F1` con `PREVIEW_STALE` y no dejan batch; si el release obtiene
  antes el lock de referencia, deja exactamente un batch/audit inmutable y el
  hecho dependiente se confirma después sin mutar su snapshot. La barrera usa
  el orden productivo `inventory → sealed reference`; evita sleeps como medio
  de ordenamiento y detecta espera real en `pg_stat_activity`.

## Límites explícitos B3

No se implementan XLSX, manifest UI ni transición `READY`. Rectificaciones y
descartes sólo son posibles con un release ya existente, por lo que no son un
blocker previo a `create_rp_release` en este bloque.

## B4 — identidad, no-ERP y performance focal

`cut2_09_rp_release_identity_no_erp_test.sql` añade 38 contratos. Cero es una
cantidad física válida; cantidad negativa, SKU LEGACY vacío, PARTIDA sin lote
y SERIAL sin serie son rechazados por constraints canónicas antes de llegar a
eligibility. No existe fallback silencioso de PARTIDA/SERIAL a SKU.

LEGACY se aísla por SKU, PARTIDA por lote y SERIAL por serie. Un blocker en B
modifica el fingerprint de un conjunto que contiene B, pero no el subset A.
Requests mixtos se rechazan completamente. Preview/create/retry no modifican
C1, movimientos, stock fuente ni lifecycle; sólo escriben batch/audit RP.

`scripts/cut2-09-rp-performance.mjs` creó y limpió 1.500 referencias locales:

| Ruta | Planning | Execution | Plan relevante |
| --- | ---: | ---: | --- |
| Eligibility (12 seleccionadas) | 13.252 ms | 4.064 ms | `inventory_sealed_references_inventory_state_idx` |
| Material preview + fingerprint | 11.243 ms | 6.421 ms | unique sealed-reference scope index |
| Validación selected ids | 2.509 ms | 2.550 ms | `inventory_sealed_references_inventory_state_idx` |
| Fuente de snapshot | 11.956 ms | 3.610 ms | scoped sealed-reference index |

Los Seq Scan observados son ramas vacías/minúsculas de UOM, findings y C2/C3
(0 filas, un loop); no hay scan material ni N+1 de selección. No se añadió
índice especulativo.

## Cierre B4 local

- Reset local desde cero: PASS.
- pgTAP completo: **47 archivos / 905 aserciones PASS**. Incluye los 38
  contratos B4 de identidad, aislamiento por LEGACY/PARTIDA/SERIAL,
  idempotencia y no mutación ERP/C1/C2/C3/findings/evidence.
- Carreras PostgreSQL: PASS para create/create (un batch/auditoría), y para
  blocker/C2/C3 versus create (previews stale o snapshot inmutable según el
  ganador del lock).
- Cliente: **81 archivos / 470 tests PASS**.
- Chromium: **49 / 49 PASS**. Se añadió un prewarm de fixture al primer caso
  `health-ready`: compila el mismo `DeviceHealthScreen` antes de la aserción
  READY y elimina el timeout de Vite cold-start sin relajar la verificación de
  producto.
- Typecheck, lint y build: PASS. Build conserva los warnings heredados de
  anotaciones de Zod y tamaño de chunks.
- DB lint: sin errores CUT2-09; se mantienen tres warnings heredados de
  funciones anteriores. La revisión local de privilegios confirma que los
  tres RPCs RP son `SECURITY DEFINER`, tienen `search_path` vacío, anon/public
  no tienen EXECUTE y sólo `authenticated` ejecuta preview/create.

## Riesgos residuales deliberados

- CUT2-09B4 no genera XLSX, manifest, transición `READY` ni escritura ERP:
  esas capacidades siguen fuera del core y no se activan implícitamente.
- El dataset de rendimiento es sintético y local (1.500 referencias); valida
  forma de plan e índices existentes, no un SLO de producción.
- Security Advisor local no produjo hallazgos CUT2-09. Persisten cuatro avisos
  heredados de RLS permisivo/initplan ajenos a esta migración y los tres
  warnings de DB lint ya enumerados; no se atribuyen ni se amplían en B4.
## CUT2-09C — manifiesto, READY y XLSX local

Validación focal local:

- `cut2_09_rp_release_manifest_export_test.sql`: 22 aserciones. Cubre DRAFT
  no exportable, READY autenticado, manifiesto/digest/cardinalidad, detalle e
  historial scoped, audit idempotente, anon denegado y ausencia de movimientos
  ERP.
- `tests/unit/rp-release-xlsx.test.ts`: 3 pruebas. Cubre filename estable,
  sanitización de inyección de fórmula, dos hojas exactas y validación del
  manifiesto antes de descargar.
- `npm run typecheck`, `npm run lint` y `npm run build`: PASS durante el
  desarrollo de CUT2-09C.

La investigación C2 descartó una fuga de rol o `search_path` de pgTAP. El
primer full-run se lanzó mientras `supabase db reset` aún reconstruía
migraciones: faltaban tablas y funciones, y el primer `lives_ok` bajo
`authenticated` fue sólo el primer síntoma. Tras esperar la migración
`20261019200447`, `phase_6_cuts_test.sql` aislado y el runner completo pasan
sin grants nuevos ni cambios al esquema de pgTAP: **48 archivos / 927
aserciones PASS**.

El timeout inicial de Chromium tampoco provenía del componente
`health-blocked`: un árbol Vite/Playwright huérfano conservaba el puerto 4174
sin servir el bundle actual. Con el proceso de certificación limpio, el caso
aislado pasa y la repetición `--repeat-each=10 --retries=0` queda 10/10 PASS.
No se aumentaron timeouts ni se desactivó el health gate.

No se agregó índice: la exportación lee una sola auditoría por `release_id`
(clave primaria) y las filas son JSON del snapshot; los índices existentes del
core continúan cubriendo preview y selección.

El lint local conserva únicamente avisos heredados ajenos a CUT2-09C:
`canonical_rectification_payload` (dos expresiones STABLE), `v_file` no usado
en `request_cut_file_generation` y `actor` no usado en
`get_inventory_lifecycle`.

El harness `npm run test:cut2-09c:e2e` ejecuta R01–R10 contra PostgreSQL
local mediante los RPCs productivos: elegibilidad, blockers, scope,
idempotencia, READY, historial/detalle, manifest/XLSX, no-ERP y C2/C3. La
suite no sustituye la frontera de autorización del servidor por un mock.

## C2 — recertificación de suites locales

El reset local fue esperado hasta que `rp_release_events` y la migración
`20261019200447` estuvieron presentes antes de arrancar el runner. El full
pgTAP resultante pasó con **48 archivos / 927 aserciones**, incluido
`phase_6_cuts_test.sql`. Por tanto no se añadió ningún grant de pgTAP a
`authenticated`: no existía una fuga de `role` ni de `search_path` que reparar
en producción.

Chromium se ejecutó con un único web server fresco y finalizó **49/49 PASS**.
El caso `health-blocked` se repitió 10 veces sin retries; su fallo histórico
era un proceso Vite/Playwright huérfano que mantenía 4174, no el health gate.
No se incrementaron timeouts ni se relajó la comprobación.

La suite cliente terminó **176 archivos / 473 pruebas PASS**. El harness
`test:cut2-09c:e2e` mantiene R01–R10 como escenarios de integración local de
RPC/PostgreSQL (sin mock de backend); la suite Chromium existente cubre la
interfaz general y el estado final PASS, pero no pretende reemplazar esas
aserciones server-side de autorización, scope y no-ERP.

Rendimiento C2 volvió a ejercitar 1.500 referencias selladas locales:
eligibility 7.347/1.808 ms, material de preview 7.601/3.863 ms, validación
0.987/0.845 ms y fuente de snapshot 5.268/1.449 ms (planning/execution).
Se usan los índices scoped de referencias selladas y de C2/C3; los Seq Scan
restantes son ramas vacías y pequeñas. No se añadió un índice especulativo.

## C6 — integración local real R01–R10

`npm run test:cut2-09c:browser-local` crea usuarios, inventarios, referencias
selladas y misiones efímeras exclusivamente en Supabase local, ejecuta las
RPCs productivas con JWT de usuario y limpia todo al terminar. La corrida
`d87f9f2d` pasó R01, R02, R03, R04, R05, R06, R07, R08, R09 y R10:

- R02 confirma que un finding crítico bloquea el release; R05 confirma
  `PREVIEW_STALE` tras un cambio material de snapshot; R03 y R06 rechazan
  actor sin capability y bodega ajena sin filtrar su identidad.
- R10 construye una C2 abierta y una C3 válida cuyo origen C2 está completado;
  ambas quedan excluidas por la autoridad de elegibilidad.
- Chromium autentica contra la instancia local, previsualiza, crea `DRAFT`,
  marca `READY` y descarga el XLSX (R01/R04/R07/R08). Sólo recibe URL y anon
  key: la service key se limita al bootstrap Node y nunca llega a Vite ni al
  navegador. El harness rechaza solicitudes no `localhost`/`127.0.0.1`.
- R09 compara el estado de referencias selladas inmediatamente antes y después
  de crear/validar/exportar: no hay mutación adicional de cantidad o cardinalidad.

El timeout de PostgREST al transformar directamente un `40001` de stale se
aisló a la pasarela local. La aserción R05 usa la misma RPC productiva con un
JWT autenticado a través de PostgreSQL local, igual que el contrato pgTAP;
no acepta ese timeout como éxito.

## CUT2-09D — recertificación global local

La recertificación se ejecutó sin despliegue, conexión remota ni datos de
producción. Un reset local desde cero aplicó todas las migraciones, incluido
`20261019200447_cut2_09c_rp_release_manifest_export`, y el pgTAP completo
terminó en **48 archivos / 927 aserciones PASS**. La suite cliente terminó en
**176 suites / 473 pruebas PASS**; Chromium heredado, **49/49 PASS**; y el
escenario `health-blocked`, **10/10 PASS** sin retries.

El harness local-real ejecutó tres corridas independientes R01–R10:
`157012d3`, `da5cfd84` y `90959a00`, todas PASS (30/30, retries 0). Después
de otro `supabase db reset --local --no-seed --yes`, la corrida `45ffd600`
volvió a pasar R01–R10. Cada corrida registra únicamente `localOnly: true`,
rechaza hosts no locales, mantiene la service key fuera de Vite/Chromium y
elimina su árbol Vite y sus fixtures efímeros.

La revisión final endureció el harness: borra toda variante de variable
service-role antes de iniciar Vite y convierte un error de cleanup en
estado/exit code de fallo, sin silenciarlo. Las tres corridas posteriores
(`7efecc1a`, `944b75d9`, `67d11a84`) fueron 10/10 PASS con
`cleanupFailure: null`.

La recertificación de concurrencia confirmó create/create y release contra
finding/C2/C3 sin duplicados, release parcial ni deadlock. El dataset local de
1.500 referencias usó los índices scoped existentes: eligibility
7.189/1.497 ms, preview 6.965/3.354 ms, selected validation 0.981/0.645 ms y
snapshot source 5.315/1.289 ms (planning/execution). No se añadió índice.

`supabase db lint --local` conserva sólo tres warnings heredados (dos
expresiones STABLE de `canonical_rectification_payload` y dos variables no
usadas en funciones anteriores). Security Advisor mantiene cuatro avisos
heredados de rendimiento/RLS en findings, assignments, master items y profiles;
no hay hallazgos atribuibles a CUT2-09.
