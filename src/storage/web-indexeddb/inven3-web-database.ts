import Dexie, { type EntityTable, type Table } from 'dexie'

export interface WebRuntimeState { key: string; value: string }
export interface WebMasterSku { inventoryId: string; codigo: string; descripcion: string; controlType: 'SERIAL' | 'PARTIDA' | 'LEGACY'; cachedAt: string }
export interface WebMasterMetadata { inventoryId: string; masterVersion: number; rowCount: number; fingerprint: string; cachedAt: string }

export class Inven3WebDatabase extends Dexie {
  public runtimeState!: EntityTable<WebRuntimeState, 'key'>
  public masterSkus!: Table<WebMasterSku, [string, string]>
  public masterMetadata!: EntityTable<WebMasterMetadata, 'inventoryId'>

  public constructor() {
    super('inven3')
    this.version(1).stores({ runtimeState: 'key' })
    this.version(2).stores({ runtimeState: 'key', masterSkus: '[inventoryId+codigo], inventoryId, codigo, cachedAt', masterMetadata: 'inventoryId, masterVersion, cachedAt' })
  }
}
