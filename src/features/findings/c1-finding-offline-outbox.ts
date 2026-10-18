/**
 * Durable, actor-bound C1 finding outbox.
 *
 * It contains only physical evidence captured by the device. Authorization is
 * deliberately rechecked by `report_c1_reference_finding` when this queue is
 * flushed; a cached item is never authority to write on the server.
 */
export type C1FindingReviewReason = 'AUTHORIZATION_REVOKED' | 'REFERENCE_SEALED' | 'STALE_ASSIGNMENT'
export type C1FindingOutboxItem = {
  schemaVersion: 1
  id: string
  sourceEventKey: string
  actorId: string
  inventoryId: string
  referenceType: 'LEGACY' | 'PARTIDA' | 'SERIAL'
  codigo: string
  referenceValue: string | null
  findingType: string
  description: string
  critical: boolean
  capturedAt: string
  evidence: Record<string, unknown>
  syncState: 'PENDING' | 'REVIEW_REQUIRED'
  reviewReason?: C1FindingReviewReason
}

export type C1FindingReporter = (item: C1FindingOutboxItem) => Promise<unknown>

const KEY = 'inven3.cut2-08.c1-finding-outbox'
let activeActorId: string | null = null

function storage(): Storage | null { try { return typeof localStorage === 'undefined' ? null : localStorage } catch { return null } }
function keyFor(actorId = activeActorId) { return `${KEY}:${actorId ?? 'anonymous'}` }
function read(): C1FindingOutboxItem[] {
  try {
    const raw = storage()?.getItem(keyFor())
    const items: unknown = raw ? JSON.parse(raw) : []
    if (!Array.isArray(items)) return []
    return items.filter((item): item is C1FindingOutboxItem => Boolean(item) && typeof item === 'object' && (item as C1FindingOutboxItem).schemaVersion === 1 && (item as C1FindingOutboxItem).actorId === activeActorId)
  } catch { return [] }
}
function write(items: C1FindingOutboxItem[]) { try { storage()?.setItem(keyFor(), JSON.stringify(items)) } catch { /* persistence is best effort; the UI keeps the unsent draft */ } }
function terminalReason(error: unknown): C1FindingReviewReason | null {
  const message = error instanceof Error ? error.message : String(error)
  if (/AUTHORIZATION_REVOKED|CAPABILITY_REQUIRED|SCOPE_DENIED|ASSIGNMENT_REVOKED|42501/.test(message)) return 'AUTHORIZATION_REVOKED'
  if (/MISSION_ASSIGNMENT_CHANGED|STALE_ASSIGNMENT/.test(message)) return 'STALE_ASSIGNMENT'
  return null
}

export const c1FindingOfflineOutbox = {
  setActor(actorId: string | null) { activeActorId = actorId },
  activeActor: () => activeActorId,
  list: () => read(),
  pending: () => read().filter((item) => item.syncState === 'PENDING'),
  reviewRequired: () => read().filter((item) => item.syncState === 'REVIEW_REQUIRED'),
  enqueue(input: Omit<C1FindingOutboxItem, 'schemaVersion' | 'id' | 'sourceEventKey' | 'actorId' | 'syncState'>) {
    if (!activeActorId) throw new Error('OFFLINE_FINDING_ACTOR_REQUIRED')
    const id = crypto.randomUUID()
    const item: C1FindingOutboxItem = { ...input, schemaVersion: 1, id, sourceEventKey: id, actorId: activeActorId, syncState: 'PENDING' }
    write([...read(), item])
    return item
  },
  async flush(reporter: C1FindingReporter): Promise<{ sent: number; reviewRequired: number; pending: number }> {
    const remaining: C1FindingOutboxItem[] = []
    let sent = 0
    let reviewRequired = 0
    for (const item of read()) {
      if (item.syncState === 'REVIEW_REQUIRED') { remaining.push(item); reviewRequired += 1; continue }
      try {
        const result = await reporter(item)
        const response = result && typeof result === 'object' ? result as { sync_state?: unknown; review_reason?: unknown } : null
        if (response?.sync_state === 'REVIEW_REQUIRED' && (response.review_reason === 'REFERENCE_SEALED' || response.review_reason === 'AUTHORIZATION_REVOKED' || response.review_reason === 'STALE_ASSIGNMENT')) {
          remaining.push({ ...item, syncState: 'REVIEW_REQUIRED', reviewReason: response.review_reason })
          reviewRequired += 1
        } else sent += 1
      }
      catch (error) {
        const reason = terminalReason(error)
        if (reason) { remaining.push({ ...item, syncState: 'REVIEW_REQUIRED', reviewReason: reason }); reviewRequired += 1 }
        else remaining.push(item)
      }
    }
    write(remaining)
    return { sent, reviewRequired, pending: remaining.filter((item) => item.syncState === 'PENDING').length }
  },
}
