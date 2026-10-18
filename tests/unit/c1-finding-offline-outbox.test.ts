import { beforeEach, describe, expect, it, vi } from 'vitest'
import { c1FindingOfflineOutbox } from '../../src/features/findings/c1-finding-offline-outbox'

function enqueue(actor = 'counter-a') {
  c1FindingOfflineOutbox.setActor(actor)
  return c1FindingOfflineOutbox.enqueue({
    inventoryId: 'inventory-a', referenceType: 'LEGACY', codigo: 'SKU-A', referenceValue: null,
    findingType: 'OTHER', description: 'Etiqueta física dañada', critical: false,
    capturedAt: '2026-10-17T12:00:00.000Z', evidence: { location: 'A-01-01' },
  })
}

describe('C1 finding offline outbox', () => {
  beforeEach(() => { localStorage.clear(); c1FindingOfflineOutbox.setActor('counter-a') })

  it('persists the owner, immutable source event and physical evidence across a store restart', async () => {
    const item = enqueue()
    c1FindingOfflineOutbox.setActor(null)
    c1FindingOfflineOutbox.setActor('counter-a')
    expect(c1FindingOfflineOutbox.list()).toEqual([expect.objectContaining({ actorId: 'counter-a', sourceEventKey: item.sourceEventKey, capturedAt: item.capturedAt, evidence: { location: 'A-01-01' } })])
    const reporter = vi.fn().mockResolvedValue('finding-a')
    await expect(c1FindingOfflineOutbox.flush(reporter)).resolves.toEqual({ sent: 1, reviewRequired: 0, pending: 0 })
    expect(reporter).toHaveBeenCalledWith(expect.objectContaining({ sourceEventKey: item.sourceEventKey, actorId: 'counter-a' }))
  })

  it('does not expose or flush A evidence after an actor switch', async () => {
    enqueue('counter-a')
    c1FindingOfflineOutbox.setActor('counter-b')
    expect(c1FindingOfflineOutbox.list()).toEqual([])
    const reporter = vi.fn().mockResolvedValue('finding-b')
    await c1FindingOfflineOutbox.flush(reporter)
    expect(reporter).not.toHaveBeenCalled()
    c1FindingOfflineOutbox.setActor('counter-a')
    expect(c1FindingOfflineOutbox.list()).toHaveLength(1)
  })

  it('makes current-authorization and stale-assignment denials terminal review items', async () => {
    enqueue()
    const revoked = vi.fn().mockRejectedValue(new Error('CAPABILITY_REQUIRED'))
    await expect(c1FindingOfflineOutbox.flush(revoked)).resolves.toEqual({ sent: 0, reviewRequired: 1, pending: 0 })
    expect(c1FindingOfflineOutbox.reviewRequired()[0]).toMatchObject({ reviewReason: 'AUTHORIZATION_REVOKED' })
    await c1FindingOfflineOutbox.flush(revoked)
    expect(revoked).toHaveBeenCalledTimes(1)

    localStorage.clear()
    enqueue()
    const stale = vi.fn().mockRejectedValue(new Error('STALE_ASSIGNMENT'))
    await c1FindingOfflineOutbox.flush(stale)
    expect(c1FindingOfflineOutbox.reviewRequired()[0]).toMatchObject({ reviewReason: 'STALE_ASSIGNMENT' })
  })

  it('preserves a retryable transport failure for an explicit later flush', async () => {
    enqueue()
    await c1FindingOfflineOutbox.flush(vi.fn().mockRejectedValue(new Error('network unavailable')))
    expect(c1FindingOfflineOutbox.pending()).toHaveLength(1)
  })

  it('makes a post-seal canonical response REVIEW_REQUIRED without retrying it', async () => {
    enqueue()
    const sync = vi.fn().mockResolvedValue({ sync_state: 'REVIEW_REQUIRED', review_reason: 'REFERENCE_SEALED' })
    await expect(c1FindingOfflineOutbox.flush(sync)).resolves.toEqual({ sent: 0, reviewRequired: 1, pending: 0 })
    expect(c1FindingOfflineOutbox.reviewRequired()[0]).toMatchObject({ reviewReason: 'REFERENCE_SEALED' })
    await c1FindingOfflineOutbox.flush(sync)
    expect(sync).toHaveBeenCalledTimes(1)
  })
})
