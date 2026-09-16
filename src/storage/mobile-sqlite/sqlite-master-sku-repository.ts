import { normalizeMasterCode, masterMetadataSchema, masterSkuSchema, type MasterMetadata, type MasterSku } from '../../domain/master/contracts'
import type { MasterSkuRepository, MasterSnapshot } from '../../domain/ports/master-sku-repository'
import type { SqliteDatabase } from './sqlite-database'

interface SqliteMasterSkuRow extends Record<string, unknown> { inventory_id: string; codigo: string; descripcion: string; control_type: MasterSku['controlType']; cached_at: string }
interface SqliteMasterMetadataRow extends Record<string, unknown> { inventory_id: string; master_version: number; row_count: number; fingerprint: string; cached_at: string }

/** SQLite implementation detail; domain callers only see MasterSkuRepository. */
export class SqliteMasterSkuRepository implements MasterSkuRepository {
  private initialized = false
  public constructor(private readonly database: SqliteDatabase) {}

  public async initialize(): Promise<void> {
    if (this.initialized) return
    await this.database.initialize()
    await this.database.execute('create table if not exists inven3_master_sku (inventory_id text not null, codigo text not null, descripcion text not null, control_type text not null check (control_type in (\'SERIAL\', \'PARTIDA\', \'LEGACY\')), cached_at text not null, unique (inventory_id, codigo))')
    await this.database.execute('create table if not exists inven3_master_metadata (inventory_id text primary key, master_version integer not null check (master_version > 0), row_count integer not null check (row_count > 0), fingerprint text not null, cached_at text not null)')
    await this.database.execute('pragma user_version = 2')
    this.initialized = true
  }

  public async findByCode(inventoryId: string, codigo: string): Promise<MasterSku | null> {
    await this.initialize()
    const result = await this.database.query<SqliteMasterSkuRow>('select inventory_id, codigo, descripcion, control_type, cached_at from inven3_master_sku where inventory_id = ? and codigo = ?', [inventoryId, normalizeMasterCode(codigo)])
    return result.values[0] ? masterSkuSchema.parse(fromSqliteSku(result.values[0])) : null
  }

  public async listByInventory(inventoryId: string): Promise<MasterSku[]> {
    await this.initialize()
    const result = await this.database.query<SqliteMasterSkuRow>('select inventory_id, codigo, descripcion, control_type, cached_at from inven3_master_sku where inventory_id = ? order by codigo', [inventoryId])
    return result.values.map((row) => masterSkuSchema.parse(fromSqliteSku(row)))
  }

  public async getMetadata(inventoryId: string): Promise<MasterMetadata | null> {
    await this.initialize()
    const result = await this.database.query<SqliteMasterMetadataRow>('select inventory_id, master_version, row_count, fingerprint, cached_at from inven3_master_metadata where inventory_id = ?', [inventoryId])
    return result.values[0] ? masterMetadataSchema.parse(fromSqliteMetadata(result.values[0])) : null
  }

  public async replaceSnapshot(snapshot: MasterSnapshot): Promise<void> {
    await this.initialize()
    const metadata = masterMetadataSchema.parse(snapshot.metadata)
    const items = snapshot.items.map((item) => masterSkuSchema.parse(item))
    if (metadata.rowCount !== items.length || new Set(items.map((item) => item.codigo)).size !== items.length || items.some((item) => item.inventoryId !== metadata.inventoryId)) throw new Error('Snapshot local inválido.')
    await this.database.transaction(async () => {
      await this.database.execute('delete from inven3_master_sku where inventory_id = ?', [metadata.inventoryId])
      for (const item of items) await this.database.execute('insert into inven3_master_sku (inventory_id, codigo, descripcion, control_type, cached_at) values (?, ?, ?, ?, ?)', [item.inventoryId, item.codigo, item.descripcion, item.controlType, item.cachedAt])
      await this.database.execute('insert into inven3_master_metadata (inventory_id, master_version, row_count, fingerprint, cached_at) values (?, ?, ?, ?, ?) on conflict(inventory_id) do update set master_version = excluded.master_version, row_count = excluded.row_count, fingerprint = excluded.fingerprint, cached_at = excluded.cached_at', [metadata.inventoryId, metadata.masterVersion, metadata.rowCount, metadata.fingerprint, metadata.cachedAt])
    })
  }
}

function fromSqliteSku(row: SqliteMasterSkuRow): MasterSku { return { inventoryId: row.inventory_id, codigo: row.codigo, descripcion: row.descripcion, controlType: row.control_type, cachedAt: row.cached_at } }
function fromSqliteMetadata(row: SqliteMasterMetadataRow): MasterMetadata { return { inventoryId: row.inventory_id, masterVersion: row.master_version, rowCount: row.row_count, fingerprint: row.fingerprint, cachedAt: row.cached_at } }
