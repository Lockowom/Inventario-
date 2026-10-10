# Auth y roles v1 — Fase 1

El cliente React usa sólo `VITE_SUPABASE_URL` y `VITE_SUPABASE_ANON_KEY`. Una única instancia `getSupabaseClient()` se comparte entre Auth, futuros repositorios y sync. `AuthService` permite leer sesión, observar cambios de sesión, recuperar usuario, perfil/rol y cerrar sesión. No implementa una pantalla de login ni autoriza operaciones mediante `user_metadata`.

`getUser()` devuelve `null` únicamente si no existe usuario/sesión o no hay cliente configurado; un error de Auth/red se propaga para no confundir un fallo técnico con logout.

El perfil se obtiene de `public.profiles` bajo RLS y se valida con Zod. El rol sólo lo administra el backend mediante la tabla protegida. La generación de tipos se prepara con `npm run db:types`; el archivo generado no se escribe manualmente.

Roles aprobados: `CONTADOR`, `ANALISTA`, `ADMIN`. Un perfil inactivo no obtiene rol operativo.

La navegación es deliberadamente mínima por rol: `CONTADOR` sólo recibe **Inicio** (Health Check) y **Conteo** (captura, reconteos asignados, sincronización y *Mis conteos*). `ANALISTA` recibe además Supervisión, Conciliación, Cortes y Maestro SKU; `ADMIN` recibe también Usuarios. Esta separación mejora la operación, pero no sustituye RLS ni las validaciones de las RPC: la autorización del servidor sigue siendo la frontera de seguridad.
