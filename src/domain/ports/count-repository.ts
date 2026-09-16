import type { LocalCountRecord } from '../count/contracts'

export interface CountListFilter { inventoryId: string; userId: string; search?: string }

/** Semantic boundary: app/use cases never import SQL, SQLite or Dexie. */
export interface CountRepository {
  getOrCreateDeviceId(): Promise<string>
  save(record: LocalCountRecord): Promise<LocalCountRecord>
  findByClientId(clientCountId: string): Promise<LocalCountRecord | null>
  listOwnCounts(filter: CountListFilter): Promise<LocalCountRecord[]>
  countPendingByDevice(deviceId: string): Promise<number>
}
