import type { LocalCountRecord } from '../count/contracts'
import type { LocalSyncAcknowledgement } from '../sync/contracts'

export interface CountListFilter { inventoryId: string; userId: string; search?: string }

export class PendingCountCapacityError extends Error {
  public constructor(public readonly maxPending: number) { super(`Se alcanzó el límite de ${maxPending} conteos pendientes en este dispositivo. Sincronice antes de continuar.`) }
}

export interface SavedPendingCount { record: LocalCountRecord; pending: number }

/** A durable outbox scope. It deliberately does not depend on capture being enabled. */
export interface OutstandingSyncScope { inventoryId: string; userId: string }

/** Semantic boundary: app/use cases never import SQL, SQLite or Dexie. */
export interface CountRepository {
  /** A registration identifier is scoped to the signed-in user and this installation. */
  getOrCreateDeviceId(userId: string): Promise<string>
  /** Atomically counts PENDING records and inserts only if the capacity remains. */
  savePendingWithCapacity(record: LocalCountRecord, maxPending: number): Promise<SavedPendingCount>
  save(record: LocalCountRecord): Promise<LocalCountRecord>
  findByClientId(clientCountId: string): Promise<LocalCountRecord | null>
  listOwnCounts(filter: CountListFilter): Promise<LocalCountRecord[]>
  /** Finds every inventory for which this user still owns durable outbox work. */
  listOutstandingSyncScopes(userId: string): Promise<OutstandingSyncScope[]>
  countPendingByDevice(deviceId: string): Promise<number>
  /** Freeze guards are scoped to this inventory and this installation only. */
  countOutstandingByInventoryDevice(inventoryId: string, deviceId: string): Promise<number>
  /** Claims at most one sync batch. Claiming is atomic with the state transition. */
  claimNextSyncBatch(input: { inventoryId: string; userId: string; max: number; now: string; forceRetry?: boolean }): Promise<LocalCountRecord[]>
  /** Returns abandoned in-flight records to retryable state after a restart/crash. */
  recoverStaleSyncing(input: { inventoryId: string; userId: string; before: string; now: string }): Promise<number>
  /** Applies only server acknowledgements that were validated by the sync manager. */
  applySyncAcknowledgements(acknowledgements: LocalSyncAcknowledgement[], now: string): Promise<void>
  /** Marks still-claimed records retryable without losing their original physical data. */
  markSyncFailed(input: { clientCountIds: string[]; error: string; nextRetryAt: string; now: string }): Promise<void>
}
