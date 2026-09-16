import { normalizeMasterCode, masterMetadataSchema, masterSkuSchema, type MasterMetadata, type MasterSku } from '../../domain/master/contracts'
import type { MasterSkuRepository, MasterSnapshot } from '../../domain/ports/master-sku-repository'
import { Inven3WebDatabase, type WebMasterMetadata, type WebMasterSku } from './inven3-web-database'

export class DexieMasterSkuRepository implements MasterSkuRepository {
  public constructor(private readonly database: Inven3WebDatabase) {}

  public async findByCode(inventoryId: string, codigo: string): Promise<MasterSku | null> {
    const item = await this.database.masterSkus.get([inventoryId, normalizeMasterCode(codigo)])
    return item ? masterSkuSchema.parse(item) : null
  }

  public async listByInventory(inventoryId: string): Promise<MasterSku[]> {
    return (await this.database.masterSkus.where('inventoryId').equals(inventoryId).sortBy('codigo')).map((item) => masterSkuSchema.parse(item))
  }

  public async getMetadata(inventoryId: string): Promise<MasterMetadata | null> {
    const metadata = await this.database.masterMetadata.get(inventoryId)
    return metadata ? masterMetadataSchema.parse(metadata) : null
  }

  public async replaceSnapshot(snapshot: MasterSnapshot): Promise<void> {
    const metadata = masterMetadataSchema.parse(snapshot.metadata)
    const items = snapshot.items.map((item) => masterSkuSchema.parse(item))
    assertSnapshot(metadata, items)
    await this.database.transaction('rw', this.database.masterSkus, this.database.masterMetadata, async () => {
      await this.database.masterSkus.where('inventoryId').equals(metadata.inventoryId).delete()
      await this.database.masterSkus.bulkAdd(items.map(toWebSku))
      await this.database.masterMetadata.put(toWebMetadata(metadata))
    })
  }
}

function assertSnapshot(metadata: MasterMetadata, items: MasterSku[]): void {
  if (metadata.rowCount !== items.length) throw new Error('La metadata no coincide con las filas del maestro.')
  if (items.some((item) => item.inventoryId !== metadata.inventoryId)) throw new Error('El snapshot mezcla inventarios.')
  if (new Set(items.map((item) => item.codigo)).size !== items.length) throw new Error('El snapshot contiene códigos duplicados.')
}

function toWebSku(item: MasterSku): WebMasterSku { return item }
function toWebMetadata(metadata: MasterMetadata): WebMasterMetadata { return metadata }
