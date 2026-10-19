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
