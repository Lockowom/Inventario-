# CUT2-07 — Validación local

Estado: certificación en curso. La evidencia final se ejecuta exclusivamente
contra Supabase local; el gate sigue bloqueado hasta que terminen las suites
completas y los controles de seguridad. La migración contiene:

- provenance `source_c2_mission_id` y cadena cut/reference;
- índice único C3 por C2 y cola C3;
- trigger idempotente de origen;
- payload C3 ciego;
- resultado C3 preparado para decisión, sin ajuste ERP;
- separación de ejecutor C2/C3 sobre el claim existente.
- una finalización C3 evidence-only: sin mayoría, sin confirmación física y
  sin segundo evento de finalización;
- caché C3 ciega y outbox aislado por actor.

CUT2-07C agrega una carrera PostgreSQL local de dos conexiones que certifica:

- una sola finalización lógica C2 genera exactamente una C3 y un solo evento
  `C3_CREATED`;
- la C3 conserva la misión C2 fuente;
- dos actores C3 no pueden reclamar la misma misión (`SKIP LOCKED`);
- el índice `recount_missions_c3_queue_idx` se usa para la cola C3.

CUT2-07D agrega una defensa de revocación sobre la misión ya reclamada:

- claim, `sync_counts`, subtareas, series, hallazgos y finalización C3 vuelven
  a comprobar `RECOUNT_C3`, la asignación y el scope actual;
- las filas de perfil, assignment y grants se bloquean antes del chequeo, de
  modo que revocación y mutación se serializan;
- `reassign_recount_mission` rechaza C3 explícitamente: C3 activa no se
  reasigna mediante la vía C2;
- una evidencia offline rechazada por revocación se conserva por actor como
  `REVIEW_REQUIRED` y no entra en reintento infinito.

Evidencia focal posterior a CUT2-07E:

- `npm run test:cut2-07:concurrency` — PASS: creación única, claim único y
  `SKIP LOCKED`, completion/revoke y claim/revoke en ambos órdenes de commit,
  reasignación C3 denegada, cadena multi-cut y aislamiento multibodega/
  multi-inventario;
- `supabase test db --local supabase/tests/cut2_07_c3_contract_test.sql` —
  contrato de bloqueo, Monitor y seguridad C3;
- `tests/unit/recount-offline-outbox.test.ts` — recuperación tras reinicio,
  snapshot versionado y aislado por actor, `REVIEW_REQUIRED` y no retry;
- Chromium — reload de C3 conserva la ejecución ciega sin exponer la
  referencia esperada.

Certificación final CUT2-07E sobre reset local:

- `supabase db reset --local --no-seed --yes` — PASS;
- `supabase test db --local supabase/tests` — 39 archivos / 717 aserciones
  PASS;
- `npm test` — 79 archivos / 457 pruebas PASS;
- `npm run test:e2e` — Chromium 42/42 PASS, sin
  `VITE_PLAYWRIGHT_FIXTURE_TIMEOUT`;
- `npm run typecheck`, `npm run lint` y `npm run build` — PASS;
- `supabase db lint --local --level error --fail-on error` — PASS;
- `supabase db advisors --local --type security --level warn --fail-on warn`
  — PASS, sin hallazgos warn/error.

Gate local: `READY_FOR_CUT2_C3_LOCAL`.

La ejecución final debe registrar DB reset, pgTAP, cliente, Chromium,
typecheck, lint, build, lint/advisor de DB y pruebas de concurrencia antes de
declarar `READY_FOR_CUT2_C3_LOCAL`.
