import { beforeEach, describe, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => ({
  rpc: vi.fn(),
  getSupabaseClient: vi.fn(),
}))

vi.mock('../../src/services/supabase', () => ({
  getSupabaseClient: mocks.getSupabaseClient,
}))

import { SupabaseC1LookupRepository } from '../../src/services/supabase-c1-lookup-repository'

const inventoryId = 'b11b0000-0000-0000-0000-000000000001'

describe('SupabaseC1LookupRepository', () => {
  beforeEach(() => {
    mocks.rpc.mockReset()
    mocks.getSupabaseClient.mockReset()
    mocks.getSupabaseClient.mockReturnValue({ rpc: mocks.rpc })
  })

  it('uses the narrow server lookup for a normalized SKU and never requests a master snapshot', async () => {
    mocks.rpc.mockResolvedValue({
      data: [{ codigo: 'SKU-001', descripcion: 'Producto QA', control_type: 'PARTIDA' }],
      error: null,
    })

    await expect(new SupabaseC1LookupRepository().lookupSku(inventoryId, ' sku-001 ')).resolves.toMatchObject({
      inventoryId,
      codigo: 'SKU-001',
      descripcion: 'Producto QA',
      controlType: 'PARTIDA',
    })
    expect(mocks.rpc).toHaveBeenCalledWith('c1_lookup_sku', {
      p_inventory_id: inventoryId,
      p_codigo: 'SKU-001',
    })
    expect(mocks.rpc).toHaveBeenCalledTimes(1)
  })

  it('looks up only the selected SKU traceability and exposes no system quantities', async () => {
    mocks.rpc.mockResolvedValue({
      data: [{ reference_value: 'LOTE-01', expiration_date: '2027-01-01' }],
      error: null,
    })

    await expect(new SupabaseC1LookupRepository().lookupTraceability(inventoryId, 'sku-001', 'PARTIDA')).resolves.toEqual([
      { value: 'LOTE-01', expirationDate: '2027-01-01' },
    ])
    expect(mocks.rpc).toHaveBeenCalledWith('c1_lookup_traceability', {
      p_inventory_id: inventoryId,
      p_codigo: 'SKU-001',
      p_control_type: 'PARTIDA',
    })
  })

  it('propagates a server authorization or scope rejection instead of falling back to an unrestricted table read', async () => {
    const denied = { code: '42501', message: 'C1_INVENTORY_NOT_AVAILABLE' }
    mocks.rpc.mockResolvedValue({ data: null, error: denied })

    await expect(new SupabaseC1LookupRepository().lookupSku(inventoryId, 'SKU-001')).rejects.toBe(denied)
    expect(mocks.rpc).toHaveBeenCalledWith('c1_lookup_sku', expect.any(Object))
  })
})
