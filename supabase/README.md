# Supabase local — Fase 1

Este directorio contiene únicamente infraestructura versionada. No hay proyecto remoto enlazado ni estas instrucciones aplican cambios a producción.

```bash
npx supabase start
npx supabase db reset
npm run db:test
npm run db:types
```

`db:types` genera `src/services/supabase.types.ts` desde el esquema local; tras enlazar explícitamente un proyecto no productivo se podrá usar `supabase gen types typescript --project-id <project-ref>`.

Las migraciones son forward-only. No se edita una migración ya aplicada. El seed contiene exclusivamente UUIDs, correos `.invalid`, nombres y SKUs ficticios de desarrollo; no crea una credencial de acceso.

GitHub Actions ejecuta obligatoriamente `supabase start`, `supabase db reset`, pgTAP y `supabase db advisors --local`; un fallo de base hace fallar CI.
