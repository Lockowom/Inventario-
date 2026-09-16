import type { LocalCountRecord } from '../count/contracts'

export interface CountListFilter { inventoryId: string; userId: string; search?: string }

export class PendingCountCapacityError extends Error {
  public constructor(public readonly maxPending: number) { super(`Se alcanzó el límite de ${maxPending} conteos pendientes en este dispositivo. Sincronice antes de continuar.`) }
}

export interface SavedPendingCount { record: LocalCountRecord; pending: number }

/** Semantic boundary: app/use cases never import SQL, SQLite or Dexie. */
export interface CountRepository {
  getOrCreateDeviceId(): Promise<string>
  /** Atomically counts PENDING records and inserts only if the capacity remains. */
  savePendingWithCapacity(record: LocalCountRecord, maxPending: number): Promise<SavedPendingCount>
  save(record: LocalCountRecord): Promise<LocalCountRecord>
  findByClientId(clientCountId: string): Promise<LocalCountRecord | null>
  listOwnCounts(filter: CountListFilter): Promise<LocalCountRecord[]>
  countPendingByDevice(deviceId: string): Promise<number>
}
