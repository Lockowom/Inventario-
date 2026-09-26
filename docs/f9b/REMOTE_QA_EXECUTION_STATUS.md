# Estado de ejecución remota F9B — INVEN3-QA

Fecha de corte: 2026-09-26 UTC.

## Alcance

Entorno único autorizado: `INVEN3-QA` (`uazunvlxlszdyweddxtb`). No se utilizaron datos productivos, no se modificó `WMS-CCO-PTM` y Fase 10 permanece fuera de alcance.

## Estado ejecutado

| Área | Resultado |
|---|---|
| Migraciones remotas | 21/21 alineadas hasta `20260926043115_phase_9_remote_default_privilege_hardening.sql` |
| Edge Functions | 4/4 `ACTIVE`, `verify_jwt = true` |
| Auth / profiles / assignments | 3 usuarios sintéticos QA, 3 perfiles activos, 3 assignments activos |
| Inventario | `INVEN3_QA_SYNTHETIC_F9B4_20260926T0535Z`, estado `ABIERTO` |
| Maestro | 3 filas: SERIAL `000123S`, PARTIDA `000725P`, LEGACY `001234` |
| Conteos | 3 aceptados; replay = `ALREADY_ACCEPTED`; total persistido = 3 |
| Rechazos | `INVALID_LOCATION`, `UNKNOWN_SKU`, `INVALID_SERIAL`, `INVALID_BATCH`, payload conflict |
| RLS | CONTADOR acceso sin gestión; ANALISTA/ADMIN gestión; sin assignment = sin acceso |
| Device Health backend | identidad, contexto, maestro, backend y server time validados |
| Corte | `CORTE 001`, 3 snapshots, `export_seq 1–3`, estado `SNAPSHOT_CREATED` |
| Storage | bucket `inventory-rp` privado, 50 MiB, RLS activo, 0 objetos antes de generar RP |
| Artefactos | 0 generated files / 0 artifact generations antes del siguiente gate |

## Cambios de aplicación requeridos y ejecutados en la rama F9

El runtime incorpora login por email/contraseña con Supabase Auth y cierre de sesión explícito. El historial de cortes expone creador y timestamp UTC utilizando `created_by`/`created_at` y el nombre visible del perfil cuando está disponible. Estos cambios no alteran schema, RLS ni contratos de negocio.

## Pendientes antes de cerrar Fase 9

- Validar una sesión real de `QA ANALISTA` desde el runtime QA.
- Ejecutar `generate-cut-rp-xlsx` para `CORTE 001` hasta `READY`.
- Confirmar XLSX remoto, SHA-256, tamaño, objeto de Storage y signed download.
- Ejecutar los escenarios remotos F8 de rectificación/artefacto en fixture sintética apropiada.
- Completar Android físico, iOS físico, importación RP real y beta interna con evidencia.
- Congelar un único release-candidate SHA y exigir CI final verde antes del PR F9 → `main`.

No declarar F9 completa ni iniciar F10 hasta cerrar esos gates.

## Runner remoto RP

El gate RP remoto se ejecuta con `npm run certify:f9b:remote-rp`. El runner está bloqueado al project ref `uazunvlxlszdyweddxtb`, usa una sesión real de ANALISTA/ADMIN, genera el corte mediante la Edge Function oficial, descarga por signed URL y vuelve a calcular SHA-256/tamaño antes de validar el contrato XLSX.

Variables requeridas localmente y nunca registradas en Git/evidencia: `VITE_SUPABASE_URL`, `VITE_SUPABASE_ANON_KEY` y `F9B_QA_ANALYST_PASSWORD`. Son opcionales los overrides `F9B_QA_ANALYST_EMAIL`, `F9B_INVENTORY_ID` y `F9B_CUT_ID`; por defecto apuntan exclusivamente a la fixture F9B.4 documentada.

El runner no imprime contraseña, JWT, anon key ni signed URL. Su salida aprobada es un resumen sanitizado `F9B_REMOTE_RP_PASS` con cut, archivo, SHA-256, tamaño y filas.
