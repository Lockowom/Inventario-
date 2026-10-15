# CUT2-01 · Modelo canónico V2.3

La migración `20261013113403_cut2_01_canonical_pre_cut2.sql` prepara el
modelo local para rolling C1/C2/C3 sin encenderlo.

## Invariantes preparados

- Identidad canónica NFC + trim + uppercase con `::`; ubicación es evidencia.
- Un sello es único por inventario, bodega, tipo e identidad normalizada.
- Inventarios nuevos tienen una bodega; los existentes quedan en `LEGACY-QA`.
- Cortes existentes son explícitamente `LEGACY_SNAPSHOT`.
- Sidecar RP, release, descartes, rectificación y backup son append-only.
- Un cierre activo es único por inventario.
- Calendario operacional contiene timezone, turnos, pausas y feriados.
- Hallazgos críticos, huérfanos, UOM y tolerancias nacen bloqueantes por
  defecto y se auditan antes de una futura exportación.

## Fuera de CUT2-01

No hay RPC de rolling cut, sellado operativo, UI, descarga/generación de XLSX,
notificaciones, movimiento físico ni workflows de recuperación. Corresponden
a CUT2-02 y fases posteriores.
