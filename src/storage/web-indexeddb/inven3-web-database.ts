import Dexie, { type EntityTable, type Table } from 'dexie'

export interface WebRuntimeState { key: string; value: string }
export interface WebMasterSku { inventoryId: string; codigo: string; descripcion: string; controlType: 'SERIAL' | 'PARTIDA' | 'LEGACY'; cachedAt: string }
export interface WebMasterMetadata { inventoryId: string; masterVersion: number; rowCount: number; fingerprint: string; cachedAt: string }
export interface WebDeviceIdentity { key: 'installation'; deviceId: string; createdAt: string }
export interface WebDeviceRegistration { userId: string; deviceId: string; createdAt: string }
export interface WebLocalCountRecord { id: string; clientCountId: string; inventoryId: string; userId: string; deviceId: string; ubicacion: string; codigo: string; serie: string | null; partida: string | null; piezaProducto: string | null; fechaVencimiento: string | null; talla: string | null; color: string | null; cantidadContada: number; descripcion: string; controlType: 'SERIAL' | 'PARTIDA' | 'LEGACY'; capturedAt: string; createdAt: string; syncStatus: 'PENDING' | 'SYNCING' | 'CONFIRMED' | 'FAILED' | 'REJECTED'; syncAttempts: number; lastSyncError: string | null; syncStartedAt: string | null; nextRetryAt: string | null; confirmedAt: string | null; serverCountId: string | null; lastSyncAt: string | null }
export interface WebCountingContext { key: 'active'; userId: string; inventoryId: string; inventoryStatus: 'ABIERTO'; verifiedAt: string }

export class Inven3WebDatabase extends Dexie {
  public runtimeState!: EntityTable<WebRuntimeState, 'key'>
  public masterSkus!: Table<WebMasterSku, [string, string]>
  public masterMetadata!: EntityTable<WebMasterMetadata, 'inventoryId'>
  public deviceIdentity!: EntityTable<WebDeviceIdentity, 'key'>
  public deviceRegistrations!: EntityTable<WebDeviceRegistration, 'userId'>
  public localCountRecords!: EntityTable<WebLocalCountRecord, 'clientCountId'>
  public countingContext!: EntityTable<WebCountingContext, 'key'>

  public constructor(databaseName = 'inven3') {
    super(databaseName)
    this.version(1).stores({ runtimeState: 'key' })
    this.version(2).stores({ runtimeState: 'key', masterSkus: '[inventoryId+codigo], inventoryId, codigo, cachedAt', masterMetadata: 'inventoryId, masterVersion, cachedAt' })
    this.version(3).stores({ runtimeState: 'key', masterSkus: '[inventoryId+codigo], inventoryId, codigo, cachedAt', masterMetadata: 'inventoryId, masterVersion, cachedAt', deviceIdentity: 'key, deviceId', localCountRecords: 'clientCountId, id, [inventoryId+userId], inventoryId, userId, deviceId, codigo, ubicacion, serie, partida, capturedAt, syncStatus' })
    this.version(4).stores({ runtimeState: 'key', masterSkus: '[inventoryId+codigo], inventoryId, codigo, cachedAt', masterMetadata: 'inventoryId, masterVersion, cachedAt', deviceIdentity: 'key, deviceId', localCountRecords: 'clientCountId, id, [inventoryId+userId], inventoryId, userId, deviceId, codigo, ubicacion, serie, partida, capturedAt, syncStatus', countingContext: 'key, userId, inventoryId, verifiedAt' })
    this.version(5).stores({ runtimeState: 'key', masterSkus: '[inventoryId+codigo], inventoryId, codigo, cachedAt', masterMetadata: 'inventoryId, masterVersion, cachedAt', deviceIdentity: 'key, deviceId', deviceRegistrations: 'userId, deviceId', localCountRecords: 'clientCountId, id, [inventoryId+userId], inventoryId, userId, deviceId, codigo, ubicacion, serie, partida, capturedAt, syncStatus, [userId+syncStatus+nextRetryAt]', countingContext: 'key, userId, inventoryId, verifiedAt' })
  }
}
