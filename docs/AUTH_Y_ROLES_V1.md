# Auth y roles v1 — Fase 1

El cliente React usa sólo `VITE_SUPABASE_URL` y `VITE_SUPABASE_ANON_KEY`. `AuthService` permite leer sesión, observar cambios de sesión, recuperar usuario, perfil/rol y cerrar sesión. No implementa una pantalla de login ni autoriza operaciones mediante `user_metadata`.

El perfil se obtiene de `public.profiles` bajo RLS y se valida con Zod. El rol sólo lo administra el backend mediante la tabla protegida. La generación de tipos se prepara con `npm run db:types`; el archivo generado no se escribe manualmente.

Roles aprobados: `CONTADOR`, `ANALISTA`, `ADMIN`. Un perfil inactivo no obtiene rol operativo.
