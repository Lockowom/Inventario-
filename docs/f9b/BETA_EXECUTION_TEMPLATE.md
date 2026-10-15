# Plantilla de beta interna

Estado inicial: `NOT_RUN`. La beta usa inventario, usuarios y datos controlados de prueba; no usa producción, Inventario General real ni implementa Fase 10.

## Registro obligatorio

| Campo | Valor de ejecución |
|---|---|
| execution_id / status | / `NOT_RUN` |
| candidate_sha / build_sha / app_version | |
| started_at / finished_at UTC | |
| operator / observer / environment | |
| role / scenario | |
| evidence_refs / defects / notes | |

## Escenarios CONTADOR

Login, Health LIGHT/FULL, conteo, scanner, digitación manual, offline, restart, reconnect, `MIS CONTEOS`, búsqueda, sync y capacidad 40/45/50.

## Escenarios ANALISTA / ADMIN

Sólo las funciones existentes: supervisión, búsqueda, cortes, detalle, XLSX, rectificación, evidencias, backups, freeze y auditoría.

## Integridad

Confirmar 0 pérdida de conteos, 0 duplicados técnicos, 0 corrupción de outbox y 0 cortes superpuestos. Cualquier violación es `FAIL` con defecto `BLOCKER` y evidencia real.
