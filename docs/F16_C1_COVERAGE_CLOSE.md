# F16 · Cierre de cobertura C1

## Problema

Mientras el inventario está abierto, una referencia Softland con físico 0 puede significar dos cosas distintas:

1. todavía nadie llegó a esa referencia;
2. realmente no fue encontrada.

Además, un mismo SKU/lote puede existir en varias ubicaciones físicas. Por eso C2 no puede nacer a partir de una diferencia parcial de C1.

## Flujo

**ABIERTO / C1 EN CURSO**

- Conteo normal registra C1.
- SKU + lote se suma entre todas sus ubicaciones.
- Conciliación en vivo es informativa.
- No se crean hallazgos definitivos ni C2 por referencias aún no cerradas.

**FINALIZAR C1**

Un ANALISTA/ADMIN confirma explícitamente que todos los dispositivos terminaron y sincronizaron.

F16 congela:
- timestamp y actor;
- número de conteos C1;
- unidades C1;
- fingerprint del Maestro;
- fingerprint RP.

Después materializa el snapshot final de discrepancias y crea una sola misión C2 por referencia.

**C2 / C3**

- C2/C3 siguen siendo ciegos.
- El servidor vincula automáticamente los conteos sincronizados con la misión activa.
- Ya no existe un RPC separado para adjuntar observaciones.
- Una referencia no encontrada puede cerrarse explícitamente en 0.
- C1 queda bloqueado después de su cierre.

**CIERRE FINAL**

`close_inventory` sólo permite ABIERTO → CERRADO cuando:
- C1 está finalizado;
- no existen casos de conciliación sin resolver;
- no quedan misiones C2/C3 en cola o activas.

## Unidad de conciliación

- PARTIDA: `SKU + partida/lote`.
- SERIAL: `SKU + serie`.
- LEGACY: `SKU`.

La ubicación es evidencia física dentro de cada ronda, no la clave de conciliación.

## Excepción Softland sin partida

Las referencias técnicas `EXC-SIN-PARTIDA:<SKU>` no se tratan como una partida física real y no generan una misión de búsqueda ficticia. Los lotes reales encontrados aparecen como referencias físicas y se concilian por separado.
