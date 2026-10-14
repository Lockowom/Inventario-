# CUT2-03K — Guards before the first rolling seal

## Root cause

The original rolling preview knew how to display unresolved UOM cases and
critical findings only after an `inventory_sealed_references` row existed.
That made both checks unreachable for the first seal of an OPEN_C1 identity.

## Model

`count_records` now retains optional `physical_uom` plus `uom_source`.
New C1 records carry `physical_uom` through the existing offline sync payload;
historical records remain `LEGACY_UNKNOWN`.  Missing evidence never means that
the physical unit equals Softland's unit.  Each inventory can opt into
`require_physical_uom_evidence`; when enabled, missing evidence blocks a
rolling seal.  An explicit mismatch or multiple explicit UOMs always blocks.

`reference_findings` was extended rather than duplicated.  It is anchored by
`inventory_id`, `warehouse_id`, `reference_type`, and
`normalized_reference_key` before a seal.  `reference_id` remains optional and
is filled automatically when the canonical identity becomes SEALED.  Existing
post-seal integrations that submit only `reference_id` retain compatibility:
a trigger derives the canonical anchor from that reference.

## Authority, audit and race semantics

Only an ADMIN or assigned ANALISTA may classify or resolve pre-seal findings
through the two authenticated RPCs.  Counters cannot create critical blocks.
`preseal_guard_events` is append-only, manager-readable audit evidence for
UOM recording, finding creation/resolution, and the post-seal link.

Both the finding RPC and `create_rolling_cut_v2` lock the inventory row.  If a
finding obtains the lock first, the freshly computed preview blocks the seal.
If the seal obtains it first, the later finding is attached directly to the
sealed reference.  The seal trigger links any pre-existing canonical findings;
none are lost.

## Backward compatibility

The `sync_counts` JSON field is additive: `physical_uom` is optional.  Local
web IndexedDB and Android SQLite migrate forward without rewriting old outbox
records.  Replays treat an explicit UOM as part of the immutable client count
identity.  Existing UOM/finding post-seal visibility remains in the preview.

## Automated proof

`supabase/tests/cut2_03k_preseal_guards_test.sql` covers:

- sync-backed pre-seal UOM match;
- UOM mismatch, mixed UOM, and policy-controlled missing evidence;
- rolling revalidation with no accidental seal;
- pre-seal critical finding, manager-only authority, and resolution audit;
- warehouse isolation;
- post-seal finding linkage and UOM audit evidence.
