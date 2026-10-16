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

La ejecución final debe registrar DB reset, pgTAP, cliente, Chromium,
typecheck, lint, build, lint/advisor de DB y pruebas de concurrencia antes de
declarar `READY_FOR_CUT2_C3_LOCAL`.
