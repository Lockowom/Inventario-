# CUT2-06 — Validación local

Este documento se completa únicamente con comandos locales. No representa un
despliegue, migración remota ni certificación de producción.

## Contratos cubiertos

- capability y scope por inventario/bodega;
- vigencia de assignment y tipos de usuario;
- Monitor scoped y sin mutación para auditor externo;
- administración scoped, self-modification y escalamiento indirecto;
- C1/C2/C3, rolling cut y correcciones con guards server-side;
- snapshot offline versionado y outbox owner-bound;
- revocación durante offline como `REVIEW_REQUIRED`, sin retry infinito;
- separación C1/C2 incluso para referencias nacidas de rolling cut.

## Ejecución certificada

- `supabase db reset --local --no-seed --yes`: PASS.
- `supabase test db --local supabase/tests`: **38 archivos / 681 aserciones
  PASS**.
- `npm test`: **79 archivos / 453 pruebas PASS**.
- `npm run test:e2e`: **Chromium 40 / 40 PASS**. La primera ejecución se
  descartó por contención de arranque al convivir con la suite cliente; la
  repetición completa y aislada pasó.
- `npm run typecheck`, `npm run lint`, `npm run build`: PASS. El build sólo
  conserva los avisos conocidos de Rollup/Zod y de tamaño de bundle.
- `supabase db lint --local --fail-on error`: PASS, con tres avisos heredados
  fuera de CUT2-06 (`canonical_rectification_payload`,
  `request_cut_file_generation`, `get_inventory_lifecycle`).
- `supabase db advisors --local --type security --fail-on error`: **0
  hallazgos**.
- `EXPLAIN (ANALYZE, BUFFERS)` del helper central y revisión de índices:
  PASS en la DB local limpia; se mantienen los índices de assignment,
  capability grants y cola C2. No se agregó un índice especulativo.

## Gate

`READY_FOR_CUT2_AUTHORIZATION_LOCAL = PASS`

La certificación es exclusivamente local. No se realizó push, deploy, cambio
remoto de Supabase, OTA, producción, iOS ni una fase CUT2 posterior.
