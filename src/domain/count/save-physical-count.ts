import { localCountRecordSchema, pendingCapacity, validatePhysicalCountDraft, type LocalCountRecord, type PendingCapacity, type PhysicalCountDraft } from './contracts'
import type { MasterSkuRepository } from '../ports/master-sku-repository'
import type { CountRepository } from '../ports/count-repository'

export interface ActiveCountingContext { inventoryId: string; userId: string; inventoryStatus: 'ABIERTO' }
export interface SavePhysicalCountDependencies { masters: MasterSkuRepository; counts: CountRepository; now?: () => Date; createUuid?: () => string }
export interface SavedPhysicalCount { record: LocalCountRecord; pending: number; capacity: PendingCapacity }

export async function savePhysicalCount(context: ActiveCountingContext, draft: PhysicalCountDraft, dependencies: SavePhysicalCountDependencies): Promise<SavedPhysicalCount> {
  const master = await dependencies.masters.findByCode(context.inventoryId, draft.codigo)
  const validated = validatePhysicalCountDraft(draft, master)
  const deviceId = await dependencies.counts.getOrCreateDeviceId(context.userId)
  const now = (dependencies.now ?? (() => new Date()))().toISOString()
  const createUuid = dependencies.createUuid ?? (() => crypto.randomUUID())
  const record = localCountRecordSchema.parse({
    ...validated,
    id: createUuid(),
    clientCountId: createUuid(),
    inventoryId: context.inventoryId,
    userId: context.userId,
    deviceId,
    capturedAt: now,
    createdAt: now,
    syncStatus: 'PENDING',
    syncAttempts: 0,
    lastSyncError: null,
    syncStartedAt: null,
    nextRetryAt: null,
    confirmedAt: null,
    serverCountId: null,
    lastSyncAt: null,
  })
  const persisted = await dependencies.counts.savePendingWithCapacity(record, 50)
  return { record: persisted.record, pending: persisted.pending, capacity: pendingCapacity(persisted.pending) }
}
