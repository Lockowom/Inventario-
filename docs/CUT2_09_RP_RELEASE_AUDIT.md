# CUT2-09 — Auditoría de release RP local

## Decisión de reutilización

La familia existente `public.rp_release_batches` es el único encabezado de
release RP. `public.rp_release_audits` conserva el sidecar inmutable,
`rp_release_discards` los descartes y `rp_release_rectifications` la cadena de
reemplazos. CUT2-09 no debe crear una segunda tabla de releases, ni mutar el
snapshot de un corte ya sellado.

| Componente existente | Estado | Decisión CUT2-09 |
| --- | --- | --- |
| `rp_release_batches` | Header con estado, artefacto y scope | KEEP / EXTEND |
| `rp_release_audits` | Snapshot, fingerprint e integridad | KEEP / EXTEND |
| `rp_release_discards` | Exclusiones auditadas | KEEP |
| `rp_release_rectifications` | Sucesión de releases | KEEP |
| `inventory_sealed_references` | Identidad y snapshot sellado | Fuente de eligibility |
| `reference_findings` | Blockers `blocks_rp` y reviews | Fuente de eligibility |
| C2/C3 `recount_missions` | Estados de recuento | Fuente de eligibility |
| RP XLSX de corte F7 | Artefacto legacy de corte | LEGACY COMPATIBILITY; no autoridad de release CUT2-09 |

## Hallazgos

- Existe la capability `RP_RELEASE` y la matriz CUT2-06 ya la limita por
  inventario/bodega; no se requiere RBAC adicional.
- Los releases `READY` y los sidecars existentes son inmutables. Falta una
  autoridad única, server-side, que derive eligibility, preview determinista,
  creación idempotente y manifest desde referencias selladas.
- `preview_rolling_cut_v2` sólo entrega una estimación pre-sello; no puede ser
  reutilizada como autoridad de release posterior al sello.
- Los helpers XLSX existentes sirven como infraestructura de serialización,
  pero el contenido debe nacer del snapshot `rp_release_audits`, nunca de
  filtros del navegador ni de datos ERP mutables.
- No se encontró una ruta CUT2 que escriba ajustes ERP automáticamente. Esto
  es un invariante explícito de CUT2-09.
- B4 verificó estática y conductualmente que el core nuevo sólo inserta en
  `rp_release_batches` y `rp_release_audits`; preview es de sólo lectura y
  create no modifica conteos, movimientos, stock fuente ni lifecycle.

## Core B2 implementado localmente

La migración `20261018220636_cut2_09_rp_release_core.sql` reutiliza los dos
modelos RP existentes para preview y snapshot DRAFT. Corrigió además una
incompatibilidad real: `recount_mission_status` sólo define `QUEUED`, `ACTIVE`,
`COMPLETED` y `CANCELLED`; por eso eligibility clasifica como abiertos sólo
`QUEUED` y `ACTIVE`, sin valores enum inexistentes.

## Límite de fase

CUT2-09 creará un artefacto exportable, auditable y scoped. No integra,
escribe ni ajusta Softland/ERP; no modifica `count_records`, disponibilidad,
misiones C1/C2/C3, snapshots sellados ni findings.
