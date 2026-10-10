# Aceptación beta interna — Fase 9

Estado de certificación: `BETA_MANUAL = MANUAL_REQUIRED`. La beta interna es no productiva, usa fixtures, inventarios de prueba y credenciales no productivas; no es rollout, release ni promoción de Fase 10. Ejecutar con la [plantilla beta F9B](f9b/BETA_EXECUTION_TEMPLATE.md).

## Roles y escenarios

- **CONTADOR:** login, Health LIGHT/FULL, conteo, scanner, digitación manual, offline, restart, reconnect, `MIS CONTEOS`, búsqueda, sync y capacidad 40/45/50.
- **ANALISTA / ADMIN:** sólo capacidades existentes: supervisión, búsqueda, cortes, detalle, XLSX, rectificación, evidencias, backups, freeze y auditoría.

## Integridad y evidencia

Registrar SHA candidato/build, versión, rol, escenario, operador, observer, timestamps UTC, ambiente, referencias de evidencia, defectos y notas. Los criterios son 0 pérdida de conteos, 0 duplicados técnicos, 0 corrupción de outbox y 0 cortes superpuestos. Cualquier violación es `FAIL`, defecto `BLOCKER` y requiere evidencia real.

No usar Inventario General real, datos productivos ni credenciales productivas. Ningún gate se autoaprueba.
