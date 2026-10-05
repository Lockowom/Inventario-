import { describe, expect, it, vi } from 'vitest'

const getSupabaseClient = vi.hoisted(() => vi.fn())
vi.mock('../../src/services/supabase', () => ({ getSupabaseClient }))

import { normalizePostgresTimestamp, SupabaseMasterSkuRepository } from '../../src/services/supabase-master-sku-repository'

const inventoryId = '11111111-1111-4111-8111-111111111111'

describe('Supabase master timestamp normalization', () => {
  it('normalizes PostgreSQL offset timestamps to strict UTC ISO', () => {
    expect(normalizePostgresTimestamp('2026-09-26 05:37:24.382693+00'))
      .toBe('2026-09-26T05:37:24.382Z')
    expect(normalizePostgresTimestamp('2026-09-26T05:37:18.429761+00:00'))
      .toBe('2026-09-26T05:37:18.429Z')
  })

  it('rejects invalid remote timestamps', () => {
    expect(() => normalizePostgresTimestamp('not-a-date')).toThrow('Timestamp remoto inválido')
  })

  it('pages through a complete remote master instead of accepting only the first 1,000 SKU', async () => {
    const range = vi.fn(async (from: number) => ({
      data: from === 0 ? rows(1_000, 0) : from === 1_000 ? rows(1_000, 1_000) : from === 2_000 ? rows(500, 2_000) : [],
      error: null,
    }))
    const query = {
      select: () => query,
      eq: () => query,
      order: () => query,
      range,
    }
    getSupabaseClient.mockReturnValue({ from: () => query })

    const result = await new SupabaseMasterSkuRepository().listByInventory(inventoryId)

    expect(result).toHaveLength(2_500)
    expect(range).toHaveBeenCalledWith(0, 999)
    expect(range).toHaveBeenCalledWith(1_000, 1_999)
    expect(range).toHaveBeenCalledWith(2_000, 2_999)
  })
})

function rows(length: number, offset: number) {
  return Array.from({ length }, (_, index) => ({
    inventory_id: inventoryId,
    codigo: `SKU${offset + index}`,
    descripcion: `Producto ${offset + index}`,
    control_type: 'LEGACY',
    created_at: '2026-10-03 17:46:29.561025+00',
  }))
}
