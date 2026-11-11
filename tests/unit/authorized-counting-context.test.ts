import { beforeEach, describe, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => ({
  getUser: vi.fn(),
  rpc: vi.fn(),
}))

vi.mock('../../src/services/supabase', () => ({
  getSupabaseClient: () => ({ auth: { getUser: mocks.getUser }, rpc: mocks.rpc }),
}))

import { verifyServerCountingContext } from '../../src/features/counting/authorized-counting-context'

const actorId = '22222222-2222-4222-8222-222222222222'
const inventoryId = 'b11b0000-0000-0000-0000-000000000001'
const warehouseId = '33333333-3333-4333-8333-333333333333'

describe('verifyServerCountingContext', () => {
  beforeEach(() => {
    mocks.getUser.mockReset()
    mocks.rpc.mockReset()
    mocks.getUser.mockResolvedValue({ data: { user: { id: actorId } }, error: null })
  })

  it('accepts PostgreSQL/PostgREST timestamps with an explicit UTC offset', async () => {
    mocks.rpc.mockResolvedValue({
      data: {
        status: 'AUTHORIZED', schema_version: 1, actor_id: actorId, role: 'ADMIN', user_type: 'PERMANENT',
        capabilities: ['COUNT_C1'], inventory_scopes: [inventoryId], warehouse_scopes: [warehouseId],
        inventory_id: inventoryId, warehouse_id: warehouseId, verified_at: '2026-11-10T19:00:00.123456+00:00',
      },
      error: null,
      status: 200,
    })

    await expect(verifyServerCountingContext(inventoryId)).resolves.toMatchObject({
      kind: 'AUTHORIZED',
      context: { userId: actorId, inventoryId, inventoryStatus: 'ABIERTO' },
    })
    expect(mocks.rpc).toHaveBeenCalledWith('get_my_counting_authorization_snapshot', { p_inventory_id: inventoryId })
  })
})
