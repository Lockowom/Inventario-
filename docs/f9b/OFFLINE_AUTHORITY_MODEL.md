# F9B — Modelo de autoridad offline

## Decisión

INVEN3 separa tres conceptos que no deben confundirse:

1. **Sesión Supabase**: mecanismo online para autenticar y obtener JWT.
2. **Contexto autorizado de conteo**: decisión server-authoritative `userId + inventoryId + ABIERTO + verifiedAt`.
3. **Runtime offline**: continuidad local basada exclusivamente en el último contexto autorizado persistido en SQLite.

## Reglas

- Con servidor disponible, `verifyServerCountingContext` es autoritativo.
- Una respuesta `AUTHORIZED` reemplaza el contexto SQLite.
- `NOT_AUTHORIZED` o `AMBIGUOUS` limpian el contexto y bloquean captura.
- Si el servidor está `UNAVAILABLE`, sólo se permite captura cuando existe contexto SQLite server-verified.
- El runtime offline no depende de `supabase.auth.getSession()`, refresh token ni access token.
- `INITIAL_SESSION` / `TOKEN_REFRESHED` con sesión nula no equivalen a logout.
- Sólo `SIGNED_OUT` y logout explícito invalidan la autoridad local.
- Logout explícito limpia el contexto aunque falle el sign-out remoto.
- El maestro SKU y los conteos permanecen locales y se validan contra el mismo `inventoryId`.
- Al recuperar conectividad, el servidor vuelve a ser autoritativo antes de aceptar nueva autoridad.

## Propósito

Este modelo garantiza que matar/reabrir el proceso Android, expirar el JWT o perder conectividad no destruyen una autorización ya verificada, a la vez que una revocación o logout confirmado no dejan una autorización offline obsoleta.
