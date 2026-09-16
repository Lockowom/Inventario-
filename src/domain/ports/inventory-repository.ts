import type { Inventory } from '../inventory/contracts'

/**
 * Puerto de dominio: los casos de uso dependen de esta semántica, nunca de SQL o Dexie.
 * Sus adaptadores se implementarán en fases posteriores para SQLite y IndexedDB/Dexie.
 */
export interface InventoryRepository {
  findById(inventoryId: string): Promise<Inventory | null>
}
