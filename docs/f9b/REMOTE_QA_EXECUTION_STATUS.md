# Estado de ejecución remota F9B — INVEN3-QA

Fecha de corte: 2026-09-27 UTC.

## Alcance

Entorno único autorizado: `INVEN3-QA` (`uazunvlxlszdyweddxtb`). No se utilizaron datos productivos, no se modificó `WMS-CCO-PTM` y Fase 10 permanece fuera de alcance.

## Estado ejecutado

| Área | Resultado |
|---|---|
| Migraciones remotas | 21/21 alineadas hasta `20260926043115_phase_9_remote_default_privilege_hardening.sql` |
| Edge Functions | 4/4 `ACTIVE`, `verify_jwt = true` |
| Auth / profiles / assignments | 3 usuarios sintéticos QA, 3 perfiles activos, 3 assignments activos; login real ANALISTA/ADMIN validado |
| Inventario | `INVEN3_QA_SYNTHETIC_F9B4_20260926T0535Z`, estado `ABIERTO` |
| Maestro | 3 filas: SERIAL `000123S`, PARTIDA `000725P`, LEGACY `001234` |
| Conteos | 3 aceptados; replay = `ALREADY_ACCEPTED`; total persistido = 3 |
| Rechazos | `INVALID_LOCATION`, `UNKNOWN_SKU`, `INVALID_SERIAL`, `INVALID_BATCH`, payload conflict |
| RLS | CONTADOR acceso sin gestión; ANALISTA/ADMIN gestión; sin assignment = sin acceso |
| Device Health backend | identidad, contexto, maestro, backend y server time validados |
| Corte | `CORTE 001`, 3 snapshots, `export_seq 1–3`, estado `READY` |
| RP oficial | `CUT_XLSX` READY, signed download PASS, SHA-256/tamaño/contrato XLSX PASS |
| Rectificación | `RECTIFICACION 001` sobre LEGACY `001234`, cantidad 2 → 3, idempotencia PASS |
| F8 artefactos | `CUT_SNAPSHOT`, `RECTIFICATION_XLSX` y `CUT_READY_BACKUP` en `READY` |
| Storage | bucket `inventory-rp` privado; 4 archivos oficiales; escritura directa de ANALISTA denegada |
| Auditoría | lifecycle `ARTIFACT_REQUESTED → FILE_GENERATED → VALIDATED → READY` validado |

## Evidencia remota RP

Runner:

```text
npm run certify:f9b:remote-rp
```

Resultado: `F9B_REMOTE_RP_PASS`.

- Cut: `99ab5613-ad5d-455d-a179-ed8f3e6f4688`
- Archivo: `INVEN3_21AC9823315345028FE0285FF79E9762_CORTE_001.xlsx`
- SHA-256: `ece3d3d966c9287d591e9d7636fe2752417e4cecb982f62020966a667951019c`
- Tamaño: `17302` bytes
- Filas: `3`

El runner usa sesión real de QA ANALISTA, genera mediante la Edge Function oficial, descarga por signed URL y recalcula SHA-256/tamaño antes de validar el contrato XLSX.

## Evidencia remota F8

Runner:

```text
npm run certify:f9b:remote-f8
```

Resultado: `F9B_REMOTE_F8_PASS`.

- `CUT_SNAPSHOT`
  - generation: `7d6fb297-f861-415c-8890-68c257ba652b`
  - SHA-256: `2e6ad1d6e9d1a567719e66c0e021780eccab95692252e7102bb2df48f1e0174f`
  - tamaño: `3903` bytes
- `RECTIFICATION_XLSX`
  - rectificación: `1943fabc-6906-448e-8f8f-17ed20c3ed38`
  - generation: `c9dd0e31-20df-49ed-92c2-3f6eccbe2608`
  - archivo: `INVEN3_21AC9823315345028FE0285FF79E9762_CORTE_001_RECTIFICACION_001.xlsx`
  - SHA-256: `9589631dac38ee187a9b978fac1953b9786281689e2e7ac3fd7e47a29a95f870`
  - tamaño: `19259` bytes
- `CUT_READY_BACKUP`
  - generation: `c0d4b30e-fe19-4bb9-ba3b-e628158f456e`
  - SHA-256: `3268bf1f2a4623a4994f222efc011f181816a8efcdbd03a896bdb3915120d821`
  - tamaño: `5568` bytes

Checks del runner: signed downloads, cadena SHA/tamaño, contratos SNAPSHOT/XLSX/ZIP, idempotencia de rectificación, as-of de CUT_READY_BACKUP, denegación ANALISTA sobre technical backup, denegación de escritura directa a Storage y lifecycle de auditoría: todos PASS.

## Incidente de provisioning Auth y forward-fix

Los tres usuarios QA inicialmente quedaron presentes en `auth.users`/Table Editor pero invisibles para Supabase Auth porque el aprovisionamiento manual dejó `instance_id = NULL` y varios strings internos de Auth en `NULL`. Los síntomas fueron: Dashboard Auth vacío, `updateUserById() = User not found` y password grant con `invalid_credentials`.

Se aplicó exclusivamente en `INVEN3-QA` un forward-fix de datos Auth para los tres usuarios sintéticos:

- `instance_id = 00000000-0000-0000-0000-000000000000`
- strings internos requeridos por Auth normalizados a `''`
- UUID, email, identities, profiles y assignments preservados

Después del forward-fix, Admin Auth API y login real funcionaron y ambos runners remotos finalizaron PASS. El procedimiento de provisión queda corregido para exigir Auth Admin API y prohibir inserciones SQL directas en `auth.users`.

## Cambios de aplicación requeridos y ejecutados en la rama F9

El runtime incorpora login por email/contraseña con Supabase Auth y cierre de sesión explícito. El historial de cortes expone creador y timestamp UTC utilizando `created_by`/`created_at` y el nombre visible del perfil cuando está disponible. Estos cambios no alteran schema, RLS ni contratos de negocio.

## Estado de gates de cierre F9

- `ANDROID_PHYSICAL = PASS`: Xiaomi 15T certificado con APK fresca, offline, reboot, persistencia SQLite, reconexión/sync, UI móvil y scanner físico.
- `BETA_MANUAL = PASS`: sign-off humano final ejecutado por Cristopher Cabezas; todas las comprobaciones del candidato fueron confirmadas y el runner emitió `[PASS] BETA_MANUAL` con evidencia `BETA-F9B-20260927T154621.json`.
- `IOS_VIRTUAL_DEVICE_MATRIX = PASS`: 23/23 perfiles WebKit desde iPhone 11 hasta iPhone 18 Pro Max; Health Check, Conteo, touch operativo y cero overflow horizontal validados.
- `IOS_NATIVE_SIMULATOR_BUILD = PENDING`: workflow macOS y fallback Codemagic preparados; aún falta build Xcode ejecutado con evidencia.
- `IOS_PHYSICAL = MANUAL_REQUIRED`: sin certificación física todavía.
- `RP_REAL_IMPORT = PASS_WITH_WARNINGS`: archivo real RP/Softland certificado contra INVEN3; 2453 SKU, 0 diferencias de conciliación, 1679 series sin duplicados y evidencia `RP-SOURCE-20260927T162115.json`. Los warnings restantes son de calidad de dato fuente y no bloquean F9.
- CI final del release candidate permanece pendiente hasta resolver los gates obligatorios abiertos.

Candidato funcional Android certificado: `2aa6645ab89c5e74dc12c9475019880aca65564f` / `f9b-qa-2aa6645a`.

No declarar F9 completa ni iniciar F10 mientras permanezca `IOS_PHYSICAL` abierto, salvo decisión explícita y documentada de alcance/no-aplicabilidad. El gate RP ya no es bloqueador.

## Variables locales de runners

Variables requeridas localmente y nunca registradas en Git/evidencia:

- `VITE_SUPABASE_URL`
- `VITE_SUPABASE_ANON_KEY`
- `F9B_QA_ANALYST_PASSWORD`
- `F9B_QA_ADMIN_PASSWORD` para el runner F8

Las credenciales, JWT, API keys secretas y signed URLs no se incluyen en evidencia ni se pegan en tickets/chat.
