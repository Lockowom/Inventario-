import { describe, expect, it, vi } from 'vitest'
import { syncC1FindingWithClient } from '../../src/services/supabase-findings-repository'

const item = {
  schemaVersion: 1 as const,
  id: 'item-1', sourceEventKey: 'event-1', actorId: 'actor-1', inventoryId: 'inventory-1',
  referenceType: 'LEGACY' as const, codigo: 'SKU-1', referenceValue: null,
  findingType: 'OTHER', description: 'Etiqueta observada', critical: false,
  capturedAt: '2026-10-18T09:00:00.000Z', evidence: { note: 'evidencia' }, syncState: 'PENDING' as const,
}

describe('SupabaseFindingsRepository offline C1 boundary', () => {
  it('returns the canonical server post-seal review response unchanged', async () => {
    const rpc = vi.fn().mockResolvedValue({ data: { finding_id: 'finding-1', sync_state: 'REVIEW_REQUIRED', review_reason: 'REFERENCE_SEALED' }, error: null })
    await expect(syncC1FindingWithClient({ rpc } as never, item)).resolves.toMatchObject({ review_reason: 'REFERENCE_SEALED' })
    expect(rpc).toHaveBeenCalledTimes(1)
    expect(rpc).toHaveBeenCalledWith('sync_offline_c1_reference_finding', expect.objectContaining({ p_source_event_key: 'event-1' }))
  })

  it('preserves an authorization-revoked physical report only through the review RPC', async () => {
    const rpc = vi.fn()
      .mockResolvedValueOnce({ data: null, error: { code: '42501', message: 'CAPABILITY_REQUIRED' } })
      .mockResolvedValueOnce({ data: { finding_id: 'finding-review', sync_state: 'REVIEW_REQUIRED', review_reason: 'AUTHORIZATION_REVOKED' }, error: null })
    await expect(syncC1FindingWithClient({ rpc } as never, item)).resolves.toMatchObject({ review_reason: 'AUTHORIZATION_REVOKED' })
    expect(rpc.mock.calls.map(([name]) => name)).toEqual(['sync_offline_c1_reference_finding', 'preserve_revoked_offline_c1_finding'])
    expect(rpc.mock.calls[1]?.[1]).toMatchObject({ p_source_event_key: 'event-1', p_inventory_id: 'inventory-1' })
  })

  it('does not hide an authorization denial if review preservation is also denied', async () => {
    const rpc = vi.fn()
      .mockResolvedValueOnce({ data: null, error: { code: '42501', message: 'CAPABILITY_REQUIRED' } })
      .mockResolvedValueOnce({ data: null, error: { code: '42501', message: 'OFFLINE_REVIEW_OWNERSHIP_DENIED' } })
    await expect(syncC1FindingWithClient({ rpc } as never, item)).rejects.toThrow('CAPABILITY_REQUIRED')
  })
})
