import { describe, expect, it } from 'vitest'
import { generateRpReleaseXlsx, rpReleaseFilename, safeSpreadsheetText, validateRpReleaseXlsx, type RpReleaseExport } from '../../src/domain/rp-release/rp-release-xlsx'

const payload: RpReleaseExport = { manifest: { release_id: 'r-1', inventory_id: 'i-1', warehouse_id: 'w-1', created_by: 'a-1', created_at: '2026-10-19T00:00:00Z', item_count: 1, schema_version: 'CUT2_09C', release_fingerprint: 'a'.repeat(64), ordered_items_digest: 'b'.repeat(64), export_version: 'CUT2_09C' }, release: { inventory_id: 'i-1', created_at: '2026-10-19T00:00:00Z', items: [{ export_seq: 1, reference_id: 'ref-1', warehouse_id: 'w-1', identity_type: 'PARTIDA', sku: '=HYPERLINK("bad")', lot: '@lot', sealed_quantity: 7, source_cut_id: 'cut-1' }] } }

describe('CUT2-09C RP release XLSX', () => {
  it('escapes formula prefixes and uses a deterministic filename', () => {
    expect(safeSpreadsheetText('=1+1')).toBe("'=1+1")
    expect(safeSpreadsheetText('-x')).toBe("'-x")
    expect(rpReleaseFilename(payload.manifest)).toBe('RP_RELEASE_i-1_w-1_r-1.xlsx')
  })
  it('contains one release sheet plus one canonical manifest without formulas', () => {
    const bytes = generateRpReleaseXlsx(payload)
    expect(bytes.byteLength).toBeGreaterThan(100)
    expect(() => validateRpReleaseXlsx(bytes, payload.manifest)).not.toThrow()
  })
  it('rejects a manifest/item cardinality mismatch before download', () => {
    expect(() => generateRpReleaseXlsx({ ...payload, manifest: { ...payload.manifest, item_count: 2 } })).toThrow('manifiesto')
  })
})
