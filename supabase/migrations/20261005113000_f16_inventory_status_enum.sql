-- F16 enum values must be committed before a later migration uses them in
-- constraints or functions. PostgreSQL deliberately rejects such use in the
-- same transaction as ALTER TYPE ... ADD VALUE.
alter type public.inventory_status add value if not exists 'C1_COMPLETADO';
alter type public.inventory_status add value if not exists 'CONCILIACION_FINAL';
alter type public.audit_event_type add value if not exists 'INVENTORY_C1_COMPLETED';
alter type public.audit_event_type add value if not exists 'INVENTORY_FINAL_RECONCILIATION_STARTED';
