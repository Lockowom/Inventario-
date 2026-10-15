# CUT2-01 · Certificación local PostgreSQL

Fecha: 2026-10-13  
Entorno: Supabase local / Docker Desktop  
Alcance: CUT2-00 y CUT2-01 únicamente; no hubo acceso a QA remoto ni a
producción.

## Resultado ejecutable

| Control | Resultado |
| --- | --- |
| `supabase db reset --local --no-seed --yes` | PASS |
| Historial de migraciones, incluidas CUT2-01 y hardening | PASS |
| pgTAP completo | PASS — 32 archivos, 522 pruebas |
| `npm run typecheck` | PASS |
| `npm run lint` | PASS |
| `npm test` | PASS |
| `npm run build` | PASS |
| Carrera PostgreSQL seal vs. seal | PASS — una inserción, un `23505` |
| Carrera PostgreSQL close vs. close | PASS — una inserción, un `23505` |
| Compatibilidad de corte legacy | PASS — `LEGACY_SNAPSHOT` / `LEGACY_V1` |
| Supabase security advisors local | PASS — sin hallazgos |

## Hardening encontrado durante la validación

La certificación reveló tres invariantes que el modelo describía, pero que no
quedaban impuestos por la base. Se agregaron en
`20261013132014_cut2_01_validation_hardening.sql` y se cubren en
`cut2_01_validation_hardening_test.sql`:

- la evidencia huérfana nace con `block_seal` y `block_rp` activos y con
  identidad canónica obligatoria;
- los hallazgos de la taxonomía crítica no pueden rebajarse a no críticos;
- una liberación RP `READY` no puede alterarse ni borrarse; las correcciones
  posteriores requieren una rectificación/superseding release futura;
- la ausencia de una decisión de criticidad se evalúa de forma segura como
  crítica mediante `cut2_reference_is_critical`.

## Límites deliberados de fase

`COUNT vs SEAL` no tiene una carrera operativa en CUT2-01: el RPC de rolling
cut/sellado fue explícitamente diferido a CUT2-03. Implementarlo sólo para
forzar esta prueba activaría parte del flujo que CUT2-01 debe mantener apagado.
Por ello, el resultado correcto es:

`READY_FOR_CUT2_01_MODEL_LOCAL_DB`

pero no `READY_FOR_CUT2_03_CONCURRENCY` ni autorización para desplegar. La
carrera real `seal vs seal` ya quedó certificada a nivel de restricción de
base; el escenario `count vs seal` debe ejecutarse con el RPC oficial cuando
CUT2-03 exista.

## Límites mantenidos

- No se aplicó ninguna migración a QA remoto o producción.
- No hubo deploy, release, push, cambios de iOS ni Windows/Tauri.
- No se activó rolling cut, sellado operativo, UI ni generación de releases
  RP.

## Riesgo heredado fuera de CUT2

`supabase db lint --local` reporta dos errores de funciones C2 preexistentes:
`record_my_recount_subtask` y `finish_my_serial_sweep` tienen una referencia
ambigua a `s.*`. Ninguno pertenece a las migraciones CUT2 ni fue introducido
por esta certificación; la suite histórica pgTAP continúa aprobada. Deben
corregirse en una tarea específica de C2 antes de considerarlos libres de
riesgo operativo.
