# F15 · Recount Missions

## Principle

A physical discrepancy is reconciled by **reference**, not by location.

- PARTIDA: `SKU + Partida/Lote`.
- SERIAL: `SKU + Serie`.
- LEGACY: `SKU`.

A reference may exist in multiple physical locations. Each location is an observation inside a recount round.

## C1

The original count remains the ordinary inventory capture. Reconciliation aggregates all C1 observations for the same reference across locations.

## C2

A discrepancy that has actually been physically observed creates one queued C2 mission.

The counter claims the next mission from **Reconteos → Iniciar siguiente**.

C2 is blind:
- no Softland quantity;
- no C1 quantity;
- no difference target;
- only SKU, description, reference and known locations.

The counter can add any number of physical locations. When the mission is finalized, C2 is the sum of its observations.

If `C1 total = C2 total`, the physical quantity is confirmed.

If `C1 total != C2 total`, F15 automatically creates a C3 mission.

## C3

C3 is a new blind mission for ANALISTA/ADMIN. It uses the same multi-location model.

When C3 is finalized, its total becomes the confirmed physical quantity and the case returns to Conciliación for final disposition.

## Open-inventory materialization

While an inventory is ABIERTO, untouched Softland references are **not** materialized as missing-stock cases. This avoids thousands of false cases before coverage is complete.

Only references with real physical observations can become C2 work during an open inventory.

## Separation of surfaces

- **Conteo**: normal C1 capture only.
- **Reconteos**: execution queue for C2/C3.
- **Conciliación**: analyst investigation and final disposition.

C2/C3 are no longer manually assigned one card at a time from Conciliación.
