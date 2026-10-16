# CUT2-07 — Validación local

Estado inicial: `BLOCKED_FOR_CUT2_C3_LOCAL` hasta ejecutar reset y las suites
finales. La migración se aplica únicamente en Supabase local y contiene:

- provenance `source_c2_mission_id` y cadena cut/reference;
- índice único C3 por C2 y cola C3;
- trigger idempotente de origen;
- payload C3 ciego;
- resultado C3 preparado para decisión, sin ajuste ERP;
- separación de ejecutor C2/C3 sobre el claim existente.

La ejecución final debe registrar DB reset, pgTAP, cliente, Chromium,
typecheck, lint, build, lint/advisor de DB y pruebas de concurrencia antes de
declarar `READY_FOR_CUT2_C3_LOCAL`.
