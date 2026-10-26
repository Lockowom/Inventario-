# CUT2-10B2 — Validación local del core de cierre

## Recuperación de infraestructura

La causa del bloqueo no era Supabase ni una migración: Docker Desktop estaba
instalado por usuario y el contexto `desktop-linux` estaba seleccionado, pero
el proceso no estaba iniciado y faltaba el pipe
`dockerDesktopLinuxEngine`. WSL2 y la distribución `docker-desktop` ya estaban
instalados y detenidos. Se inició exclusivamente Docker Desktop; no se
reinició WSL, no se borraron volúmenes, imágenes ni distribuciones, y no se usó
ningún servicio remoto.

Con Docker activo, `docker info`, `docker ps` y `supabase status --output json`
confirmaron un stack local (`127.0.0.1`). El reset local aplica las migraciones
en segundo plano en esta versión del CLI; la certificación espera tanto la
migración `20261024200701` como la función `close_inventory_final` antes de
ejecutar pruebas.

## Implementación verificada

- `app_private.inventory_close_readiness(uuid)` es la única autoridad de
  readiness y produce una huella SHA-256 determinista sin efectos laterales.
- `preview_inventory_close` exige `CLOSE_INVENTORY`, scope de inventario y
  bodega; no crea requests ni auditoría.
- `close_inventory_final` bloquea el inventario, revalida la huella, reutiliza
  `inventory_close_requests`, es idempotente por request y escribe un único
  evento `INVENTORY_CLOSED`.
- El cierre no escribe ERP, movimientos ni stock. Los guards rechazan nuevas
  misiones de recount y batches RP para un inventario ya cerrado.

## Resultados ejecutados

| Comando | Resultado |
| --- | --- |
| `supabase db reset --local --no-seed --yes` | PASS — base limpia hasta `20261024200701` |
| pgTAP focal CUT2-10 | PASS — core 26, blockers 25 y scope 8 aserciones |
| `supabase test db --local supabase/tests` | PASS — 51 archivos / 986 aserciones |
| `node scripts/cut2-10-postgres-concurrency.mjs` | PASS — conexiones PostgreSQL independientes para close/close, finding/C2/C3 antes del close, RP READY antes del close y guards post-close |
| `supabase db lint --local` | PASS — sin avisos CUT2-10; 3 avisos heredados |
| `supabase db advisors --local --type security --level info` | PASS — 0 hallazgos nuevos CUT2-10; sólo avisos heredados de RLS sin policy |
| `npx vitest run tests/unit/artifact-panel.test.tsx` × 10 | PASS — 10/10, sin retry |
| `npm test` | PASS — 83 archivos / 475 pruebas |
| adapter CUT2-10 | PASS — 1 archivo / 2 pruebas |
| `npm run typecheck` | PASS |
| `npm run lint` | PASS — cero warnings permitidos |
| `npm run build` | PASS — 302 módulos; 20,34 s |

`preview_inventory_close` y `close_inventory_final` no son ejecutables por
`anon`; sólo `authenticated` recibe el grant público. Las tres funciones de
close usan `SECURITY DEFINER` con `search_path` vacío y objetos calificados.

## Evidencia B3 adicional

- `supabase db advisors --local --type security` se ejecutó contra el stack
  local. Sus avisos son preexistentes (políticas/objetos de CUT anteriores); no
  reporta ninguna función, tabla o grant introducido por CUT2-10.
- Un ataque como `authenticated` a `UPDATE public.inventories` recibió
  `permission denied`; el lifecycle no es escribible directamente por cliente.
- Un dataset transaccional, local y descartado de 1.500 referencias selladas
  ejecutó `inventory_close_readiness` en 79,255 ms, con 13.508 buffers shared
  hit y sin lecturas de disco. La función devuelve intencionalmente el
  material sellado para la huella; no se añadió un índice sin una consulta
  interna identificada que lo justificase.

## Timeout heredado de cliente

El timeout inicialmente atribuido a `artifact-panel` no se reproduce aislado.
La corrida completa mostró saturación de workers jsdom (`onTaskUpdate`) y
timeouts cruzados en tests no relacionados. Se limitó la ejecución a cuatro
workers en `vite.config.ts`; no se modificó ningún timeout, mock ni aserción.
La nueva corrida completa pasó y las diez ejecuciones aisladas de
`artifact-panel` también.

## Evidencia B3 de carreras y límites de escritura

El harness `scripts/cut2-10-postgres-concurrency.mjs` abre una conexión `psql`
por operación y limpia sus fixtures sólo con privilegios de administrador
local. No emplea mutex ni promesas dentro de una única transacción.

- **close/close:** el inventario se bloquea primero; una sola request termina
  `COMPLETED` y se emite un único `INVENTORY_CLOSED`.
- **finding primero:** un finding pre-seal crítico creado por su RPC canónica
  cambia la huella material. El close con la preview anterior devuelve
  `PREVIEW_STALE` y no deja request, lifecycle ni auditoría parcial.
- **C2/C3 primero:** se persisten una case y misión C2, y una C3 cuya cadena se
  deriva del C2 completado por el trigger productivo. Ambos cambios invalidan
  la preview y el close no muta el lifecycle.
- **RP primero:** una referencia sellada alcanza `READY` exclusivamente por
  `create_rp_release` y `mark_rp_release_ready`. Sólo entonces la preview de
  close queda lista y el cierre procede.
- **close primero:** insertos posteriores de C2, C3 y batch RP son rechazados.
  La ruta específicamente pre-seal de findings también devuelve
  `INVENTORY_CLOSED`; la preservación de evidencia tardía continúa siendo la
  responsabilidad de los intake formales de CUT2-04/CUT2-08.

El orden observado del escritor es `capability/scope → inventory FOR UPDATE →
request idempotente FOR UPDATE → recomputación de readiness → request/audit`.
Los writers pre-seal también toman el lock del inventario. Las carreras
ejecutadas no produjeron deadlock.

## Evidencia B4 — blockers y scope

`cut2_10_inventory_close_blockers_test.sql` materializa fuentes canónicas y
incluye la transición ya terminal como `INVALID_LIFECYCLE`, que el writer
rechaza de manera explícita con `INVENTORY_ALREADY_CLOSED`. Además certifica la
lectura y el rechazo de close para: referencia `SEALING`, case de
reconciliación, C2 `QUEUED`/`ACTIVE`, C3 `QUEUED`/`ACTIVE`, finding crítico,
review offline revocado, huérfano, conflicto de identidad, UOM, cantidad
sellada desconocida, guard de sync, referencia RP omitida, release `DRAFT`,
integridad RP, rectificación y discard pendientes. No modifica readiness: cada
resultado se obtiene a través del RPC scoped y el cierre bloqueado no deja
lifecycle ni audit parcial.

`cut2_10_inventory_close_scope_test.sql` certifica inventario extranjero,
capability ausente y actor inactivo. El modelo vigente es inventario → una
bodega canónica; por ello no existe un cierre parcial multi-bodega que probar.
La negación ocurre antes de exponer readiness, bodega, releases o conteos.

La cantidad sellada negativa no puede materializarse por constraint canónico;
el readiness trata `physical_quantity IS NULL` como `NEGATIVE_QUANTITY`, que
es el estado persistible equivalente de cantidad no válida. Cantidad cero sigue
siendo válida conforme a CUT2-09.

El build final terminó con código cero y Vite reportó `302 modules transformed`
y `built in 20.34s`. Permanecen sólo avisos heredados de anotaciones Zod/Rollup
y tamaño de chunk; no se cambió su configuración.

El arnés de carreras genera UUIDs de fixture por ejecución. Con ello dos
invocaciones superpuestas no pueden contaminar la aserción de unicidad de una
ejecución independiente; la serialización que se certifica continúa ocurriendo
en PostgreSQL mediante los locks del escritor, no en el cliente.
