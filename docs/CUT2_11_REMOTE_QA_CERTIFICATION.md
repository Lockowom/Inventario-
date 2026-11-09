
## CUT2-11B — actualización Chromium y Realtime — 2026-11-09

- `QA_ADMIN`: login y logout PASS. Recorrido local contra QA remoto PASS: Conteo, Reconteos, Centro de Control, Carga de datos, Cortes, Liberación RP, Maestro SKU y Usuarios.
- `QA_ANALISTA`: login/logout y recorrido operativo ya PASS: Conteo, Reconteos, Centro de Control, Carga de datos, Cortes, Liberación RP y Maestro SKU. La suscripción del Centro de Control alcanzó `EN VIVO`; el cliente usa Realtime sólo como invalidación y vuelve a consultar el read-model/RPC scoped.
- `QA_CONTADOR`: login/logout PASS. Sólo pudo recorrer Conteo y Reconteos; Usuarios, Liberación RP y cierre final no fueron renderizados. Las denegaciones HTTP para esas operaciones privilegiadas se mantienen como controles server-side previos.
- Network assertion en las tres sesiones: exclusivamente `kpsdephjbvkwvazxubtb.supabase.co`; QA histórico y producción: 0 solicitudes. Inspección de localStorage/sessionStorage: service-role: 0 exposiciones.
- C01–C05 de concurrencia remota, PREVIEW_STALE e idempotencia permanecen PASS según la ejecución sintética anterior. No se tocaron producción, QA histórico, ERP/Softland, stock ni Android.

### Matriz completada en esta reanudación

| Área | Evidencia | Resultado |
| --- | --- | --- |
| ADMIN Chromium | Login/logout y ocho rutas permitidas, incluida Usuarios | PASS |
| CONTADOR Chromium | Login/logout; Conteo y Reconteos solamente; rutas privilegiadas ausentes | PASS |
| ANALISTA / Realtime | Recorrido operativo y señal `EN VIVO` del Centro de Control | PASS |
| Network target | Solicitudes externas de las tres sesiones: sólo `kpsdephjbvkwvazxubtb.supabase.co` | PASS |
| Aislamiento de secretos | Inspección de `localStorage` y `sessionStorage`: ninguna service-role key | PASS |
| Monitor / Supervisión | Read-model scoped y refresco por invalidación Realtime; controles de UI cubiertos por sus pruebas | PASS |
| Migraciones QA | `supabase db push --linked --dry-run`: remoto actualizado, sin aplicar cambios | PASS |
| Lint de esquema remoto | `supabase db lint --linked --schema public,app_private`: sin errores | PASS |
| Preflight de release | `tests/unit/release-preflight.test.ts`: 8/8 | PASS |

### Límites y seguridad

- Target remoto: sólo QA nuevo `kpsdephjbvkwvazxubtb`; QA histórico y producción no recibieron solicitudes.
- No se ejecutaron `db reset`, `migration repair`, migraciones, operaciones ERP/Softland ni mutaciones de stock.
- El acceso privilegiado empleado por los harnesses queda en proceso local; el navegador recibió únicamente configuración pública de QA.
- Android queda expresamente fuera de este bloque y es el siguiente gate (`CUT2-11C`).
