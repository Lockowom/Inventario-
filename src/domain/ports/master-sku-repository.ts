import type { MasterMetadata, MasterSku } from '../master/contracts'

export interface MasterSnapshot {
  items: MasterSku[]
  metadata: MasterMetadata
}

/** Semantic domain boundary for online and offline master snapshots. */
export interface MasterSkuRepository {
  findByCode(inventoryId: string, codigo: string): Promise<MasterSku | null>
  listByInventory(inventoryId: string): Promise<MasterSku[]>
  getMetadata(inventoryId: string): Promise<MasterMetadata | null>
  replaceSnapshot(snapshot: MasterSnapshot): Promise<void>
}
