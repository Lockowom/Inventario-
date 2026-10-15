import fs from 'node:fs'
import path from 'node:path'
import { describe, expect, it } from 'vitest'

const migrationPath = path.join(process.cwd(), 'supabase/migrations/20261013113403_cut2_01_canonical_pre_cut2.sql')
const hardeningMigrationPath = path.join(process.cwd(), 'supabase/migrations/20261013132014_cut2_01_validation_hardening.sql')
const previewMigrationPath = path.join(process.cwd(), 'supabase/migrations/20261013143428_cut2_02_read_only_preview.sql')
const migration = () => fs.readFileSync(migrationPath, 'utf8').replace(/\r\n/g, '\n')
const hardeningMigration = () => fs.readFileSync(hardeningMigrationPath, 'utf8').replace(/\r\n/g, '\n')
const previewMigration = () => fs.readFileSync(previewMigrationPath, 'utf8').replace(/\r\n/g, '\n')

describe('CUT2-01 canonical local model contract', () => {
  it('keeps the model additive and preserves the legacy cut mode', () => {
    const sql = migration()
    expect(sql).toContain("add column cut_mode public.cut2_cut_mode not null default 'LEGACY_SNAPSHOT'")
    expect(sql).toContain('legacy cuts continue to use their existing snapshot flow')
    expect(sql).not.toContain('drop table public.inventory_cuts')
    expect(sql).not.toContain('drop table public.count_records')
  })

  it('defines warehouse-scoped canonical reference identity and collision protection', () => {
    const sql = migration()
    expect(sql).toContain('create table public.warehouses')
    expect(sql).toContain('add column warehouse_id uuid')
    expect(sql).toContain('create or replace function public.normalize_reference_key')
    expect(sql).toContain("Reference fields cannot contain ::")
    expect(sql).toContain('unique (inventory_id, warehouse_id, reference_type, normalized_reference_key)')
  })

  it('models auditability before activation of rolling cuts', () => {
    const sql = migration()
    for (const table of [
      'inventory_sealed_references', 'reference_tolerance_decisions', 'reference_findings',
      'orphan_references', 'rp_release_batches', 'rp_release_audits',
      'rp_release_rectifications', 'inventory_close_backups', 'notification_policies',
    ]) expect(sql).toContain(`create table public.${table}`)
    expect(sql).toContain('verify_rp_release_integrity_metadata')
    expect(sql).toContain('validate_inventory_close_backup')
    expect(sql).toContain('CUT2 immutable history cannot be updated or deleted')
  })

  it('keeps direct Data API writes closed and enables RLS for every new operational table', () => {
    const sql = migration()
    expect(sql).toContain('alter table public.inventory_sealed_references enable row level security')
    expect(sql).toContain('revoke all on public.operational_hours')
    expect(sql).toContain('from authenticated;')
    expect(sql).not.toContain('service_role')
  })

  it('hardens orphan, critical finding, and official release invariants without enabling rolling cuts', () => {
    const sql = hardeningMigration()
    expect(sql).toContain('add column block_seal boolean not null default true')
    expect(sql).toContain('add column block_rp boolean not null default true')
    expect(sql).toContain('reference_findings_critical_taxonomy_check')
    expect(sql).toContain('cut2_reference_is_critical')
    expect(sql).toContain('rp_release_batches_ready_immutable')
    expect(sql).not.toContain('create_rolling_cut_v2')
    expect(sql).not.toContain('service_role')
  })

  it('defines a security-scoped, read-only CUT2 preview without enabling the rolling workflow', () => {
    const sql = previewMigration()
    expect(sql).toContain('create or replace function public.preview_rolling_cut_v2')
    expect(sql).toContain('stable')
    expect(sql).toContain('Not authorized for rolling cut preview')
    expect(sql).toContain("'preview_fingerprint'")
    expect(sql).toContain('revoke all on function public.preview_rolling_cut_v2')
    expect(sql).not.toContain('create_rolling_cut_v2')
    expect(sql).not.toContain('insert into public.recount_missions')
    expect(sql).not.toMatch(/\b(insert|update|delete)\s+(into\s+)?public\./i)
    expect(sql).not.toContain('rp_release_batches')
    expect(sql).not.toContain('service_role')
  })
})
