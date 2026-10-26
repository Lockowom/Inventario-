import { describe, expect, it } from 'vitest'
import { inventoryCloseReadinessSchema } from '../../src/domain/inventory-close/contracts'

describe('inventory close transport contracts', () => {
  it('accepts the legacy PostgreSQL warehouse UUID emitted by the scoped close preview', () => {
    expect(() => inventoryCloseReadinessSchema.parse({
      inventory_id: '10000000-0000-4000-8000-000000000001',
      warehouse_id: '00000000-0000-0000-0000-00000000c202',
      current_status: 'ABIERTO', target_status: 'CERRADO', is_ready: true, fingerprint: 'a'.repeat(64),
      blocker_codes: [], blockers: [], blocker_counts: {}, material_summary: {},
    })).not.toThrow()
  })
})
