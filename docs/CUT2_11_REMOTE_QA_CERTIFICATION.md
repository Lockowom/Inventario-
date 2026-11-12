
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
- Android queda expresamente fuera de este bloque y es el siguiente gate (`CUT2-11C`). Su estado y evidencia física están en [CUT2_11C_ANDROID_QA_CERTIFICATION.md](CUT2_11C_ANDROID_QA_CERTIFICATION.md).

## QA live reconciliation + OTA effective version — 2026-11-12

Target exclusivo: `kpsdephjbvkwvazxubtb` (`LOCK AND FREE`, `ACTIVE_HEALTHY`). No se contactó producción ni el QA histórico.

### Migraciones aplicadas y verificadas

- `20261111223135_live_reconciliation_c2_c3_without_c1_close.sql`: aplicada realmente mediante `supabase db push --linked`; el ledger remoto coincide con local.
- `20261112102540_ota_effective_app_version_contract.sql`: aplicada inmediatamente después; el ledger remoto termina en `20261112102540` sin gaps.
- QA contiene el trigger `count_records_live_c1_reconciliation`, el índice natural abierto de casos y la restricción única de misión por caso/ronda.
- Inspección remota: el claim de C2 no condiciona por `c1_completed_at` ni `source_cut_id`; el trigger usa la referencia backend y bloqueo advisory por identidad. Hay cuatro C2 y una C3 activas sin `source_cut_id`, evidencia de disponibilidad con inventario abierto.
- C3 sigue originándose al cerrar C2 con desacuerdo C1/C2. RLS está habilitado en casos, misiones, eventos, bundles, dispositivos y eventos de dispositivos.

### Validación focal

| Control | Resultado |
| --- | --- |
| `live_reconciliation_c2_c3_test.sql` | PASS, 25 assertions |
| `c2_2_hybrid_recount_contract_test.sql` | PASS, 22 assertions |
| Carrera PostgreSQL de reconciliación | PASS: una identidad produce un caso, una misión y un evento de creación |
| `ota_qa_beta_contract_test.sql` | PASS, 6 assertions |
| Cliente OTA/versionado | PASS, 4 files / 22 tests |
| `supabase db lint --linked` | Sin errores; sólo warnings heredados ya documentados |
| Edge `ota-updates` | Desplegada en QA, `verify_jwt=true`; request sin JWT devuelve 401 |
| Edge `ota-publish` | Desplegada en QA; publisher sin token devuelve 401 |

### Candidato OTA inmutable

- Bundle local: `artifacts/ota/INVEN3-QA-OTA-v0.0.00.03.zip`.
- `appVersion`: `0.0.00.03`; base nativa mínima: `0.0.00.02` / `versionCode=2`; canal: `qa-beta`.
- SHA-256 recalculado: `286ffeadb4058e4b10b945dc86f3a08f38c034e91e844482052cf4d7470c651a`.
- Tamaño: `1,868,733` bytes.

### Bloqueo de publicación y prueba física

La publicación no fue eludida: el único publisher aceptado requiere `OTA_PUBLISH_TOKEN`, que existe exclusivamente como secreto de GitHub Actions. El workflow `OTA QA Beta` permite publicar únicamente desde `refs/heads/qa`; el candidato certificado está en `qa-cut2-11-preprod` (`6809931083ba4677556202d6ed47795b8c299a94`), ya enviado al remoto sin force-push. No se insertó un bundle directamente en la base ni se creó una release parcialmente registrada.

La prueba física OTA permanece pendiente hasta que el candidato sea promovido por la ruta CI autorizada. En esta ejecución ADB no detectó el Xiaomi `25069PTEBG`; no hubo instalación, borrado de datos ni reconstrucción de APK.
