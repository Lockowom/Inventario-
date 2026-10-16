# CUT2-07 — Validación local

Estado: certificación en curso. El reset local se recuperó y el contrato
conductual focal pasó (`35` aserciones entre F15 y CUT2-07). Aún faltan las
suites completas, concurrencia, E2E y revisión de rendimiento antes del gate
final. La migración se aplica únicamente en Supabase local y contiene:

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

Evidencia focal posterior a CUT2-07D:

- `npm run test:cut2-07:concurrency` — PASS: creación única, claim único,
  `SKIP LOCKED`, reasignación C3 denegada, revocación deniega completion y
  una restauración posterior produce un solo audit de finalización;
- `supabase test db --local supabase/tests/cut2_07_c3_contract_test.sql` —
  PASS: 22 aserciones;
- `tests/unit/recount-offline-outbox.test.ts` — PASS: 4 pruebas, incluida la
  preservación `AUTHORIZATION_REVOKED`.

La ejecución final debe registrar DB reset, pgTAP, cliente, Chromium,
typecheck, lint, build, lint/advisor de DB y pruebas de concurrencia antes de
declarar `READY_FOR_CUT2_C3_LOCAL`.
