# Manifest futuro de despliegue QA remoto — F9B.2

Estado: `NOT_AUTHORIZED`. No contiene valores, credenciales, project ref ni acciones ejecutadas. Sólo enumera artefactos que un flujo aprobado podría evaluar después de validar identidad, historial y divergencias del proyecto QA/STAGING.

## Artefactos versionados a considerar

| Categoría | Artefactos | Requisito F9B |
|---|---|---|
| Migraciones | las 20 SQL en `supabase/migrations/`, desde `20260916133820_phase_1_initial_model_security.sql` hasta `20260926001414_device_health_server_time.sql` | Sí, sólo las faltantes y conocidas tras comparar history/diff |
| Seed/dataset | `supabase/seed/phase_1_safe_dev_seed.sql` como referencia de forma; dataset sintético QA separado y aprobado | Sí, pero no aplicar seed de desarrollo sin revisión |
| Edge | `generate-cut-rp-xlsx`, `download-cut-rp-xlsx`, `generate-inventory-artifact`, `download-inventory-artifact` y `_shared` | Sí, las cuatro con JWT verificado |
| Bucket | `inventory-rp`, privado, 50 MiB, XLSX/JSON/ZIP | Sí |
| Policies/grants/RPC/RLS | los contenidos en migraciones versionadas, incluido `public.get_server_time()` | Sí, verificación antes y después |
| Tests | pgTAP e integraciones locales existentes | Precondición de CI, no despliegue remoto |

## Secret names, nunca valores

| Uso | Nombre permitido | Dónde vive |
|---|---|---|
| CI/CLI de despliegue | `SUPABASE_ACCESS_TOKEN` | secreto cifrado del entorno QA |
| CI/CLI de despliegue | `SUPABASE_PROJECT_ID` | secreto/configuración restringida de QA |
| CI/CLI de despliegue | `SUPABASE_DB_PASSWORD` | secreto cifrado del entorno QA |
| Cliente QA | `VITE_SUPABASE_URL`, `VITE_SUPABASE_ANON_KEY` | `.env.local` ignorado o variables de build; valores publishable |
| Runtime Edge | secretos predeterminados de plataforma y cualquier secreto adicional aprobado | administración de secretos del proyecto QA, nunca repositorio/bundle |

Prohibidos: service-role/secret key en frontend, access token, contraseña DB, JWT secret y cualquier valor Edge en Git, logs, evidencia o artefactos Android/iOS.

## Dataset QA futuro

Un inventario `ABIERTO`, maestros y conteos sintéticos; tres perfiles QA (`CONTADOR`, `ANALISTA`, `ADMIN`) activos y asignados; muestras SERIAL/PARTIDA/LEGACY, ceros iniciales, `00725`, `001234`, fechas presentes/ausentes, talla/color. No se usa Inventario General ni datos productivos.

## Condiciones de despliegue

No realizar `supabase link`, `db push`, migration repair, SQL remoto, deploy de función, bucket, usuario o carga de datos hasta: identidad QA confirmada, autorización explícita, history remoto leído, divergencias/diff revisados, backup definido y CI verde. El rollback se hace con backup cuando corresponda y migraciones forward-fix revisadas, no reescribiendo historial.
