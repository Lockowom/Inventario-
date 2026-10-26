import { describe, expect, it, vi } from 'vitest'

const supabaseMock = vi.hoisted(() => ({ getSupabaseClient: vi.fn() }))
vi.mock('../../src/services/supabase', () => ({ getSupabaseClient: supabaseMock.getSupabaseClient }))

import { SupabaseInventoryCloseRepository } from '../../src/services/supabase-inventory-close-repository'

const readiness = {
  inventory_id: '10000000-0000-4000-8000-000000000001', warehouse_id: '20000000-0000-4000-8000-000000000001',
  current_status: 'ABIERTO', target_status: 'CERRADO', is_ready: true,
  fingerprint: 'a'.repeat(64), blocker_codes: [], blockers: [], blocker_counts: {}, material_summary: {},
}

describe('SupabaseInventoryCloseRepository', () => {
  it('uses the scoped preview RPC and validates its stable readiness contract', async () => {
    const rpc = vi.fn().mockResolvedValue({ data: readiness, error: null })
    supabaseMock.getSupabaseClient.mockReturnValue({ rpc })
    await expect(new SupabaseInventoryCloseRepository().previewInventoryClose(readiness.inventory_id)).resolves.toEqual(readiness)
    expect(rpc).toHaveBeenCalledWith('preview_inventory_close', { p_inventory_id: readiness.inventory_id })
  })

  it('sends expected fingerprint and request id to the canonical close RPC', async () => {
    const rpc = vi.fn().mockResolvedValue({ data: { inventory_id: readiness.inventory_id, close_request_id: '30000000-0000-4000-8000-000000000001', status: 'CERRADO', fingerprint: readiness.fingerprint, idempotent: false }, error: null })
    supabaseMock.getSupabaseClient.mockReturnValue({ rpc })
    await new SupabaseInventoryCloseRepository().closeInventoryFinal(readiness.inventory_id, readiness.fingerprint, '40000000-0000-4000-8000-000000000001')
    expect(rpc).toHaveBeenCalledWith('close_inventory_final', { p_inventory_id: readiness.inventory_id, p_expected_fingerprint: readiness.fingerprint, p_request_id: '40000000-0000-4000-8000-000000000001' })
  })
})
