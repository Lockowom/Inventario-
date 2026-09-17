import { describe, expect, it } from 'vitest'
import { createMasterFingerprint } from '../../src/domain/master/contracts'
import { refreshMasterSnapshot } from '../../src/domain/master/offline-master'
import type { MasterSkuRepository, MasterSnapshot } from '../../src/domain/ports/master-sku-repository'
import { DexieMasterSkuRepository } from '../../src/storage/web-indexeddb/dexie-master-sku-repository'
import { Inven3WebDatabase } from '../../src/storage/web-indexeddb/inven3-web-database'
import { SqliteMasterSkuRepository } from '../../src/storage/mobile-sqlite/sqlite-master-sku-repository'
import type { SqliteDatabase, SqliteResult } from '../../src/storage/mobile-sqlite/sqlite-database'
import { applySqliteMigrations, SQLITE_MIGRATIONS } from '../../src/storage/mobile-sqlite/sqlite-migrations'

const inventoryId = '11111111-1111-4111-8111-111111111111'
const snapshotItems: MasterSnapshot['items'] = [
  { inventoryId, codigo: '00001', descripcion: 'Uno', controlType: 'LEGACY', cachedAt: '2026-09-16T00:00:00.000Z' },
  { inventoryId, codigo: 'ABCSP', descripcion: 'Dos', controlType: 'PARTIDA', cachedAt: '2026-09-16T00:00:00.000Z' },
]

async function createSnapshot(version = 1, items = snapshotItems): Promise<MasterSnapshot> {
  return {
    items,
    metadata: { inventoryId, masterVersion: version, rowCount: items.length, fingerprint: await createMasterFingerprint(items), cachedAt: '2026-09-16T00:00:00.000Z' },
  }
}

function sharedMasterContract(name: string, createRepository: () => { findByCode: (id: string, code: string) => Promise<unknown>; listByInventory: (id: string) => Promise<unknown[]>; getMetadata: (id: string) => Promise<unknown>; replaceSnapshot: (value: MasterSnapshot) => Promise<void> }) {
  describe(name, () => {
    it('guarda, busca y expone metadata', async () => {
      const repository = createRepository()
      const snapshot = await createSnapshot()
      await repository.replaceSnapshot(snapshot)
      await expect(repository.findByCode(inventoryId, ' 00001 ')).resolves.toMatchObject({ codigo: '00001', descripcion: 'Uno' })
      await expect(repository.listByInventory(inventoryId)).resolves.toHaveLength(2)
      await expect(repository.getMetadata(inventoryId)).resolves.toMatchObject({ masterVersion: 1, rowCount: 2 })
    })

    it('rechaza un snapshot inválido sin reemplazar el anterior', async () => {
      const repository = createRepository()
      const snapshot = await createSnapshot()
      await repository.replaceSnapshot(snapshot)
      await expect(repository.replaceSnapshot({ ...snapshot, metadata: { ...snapshot.metadata, rowCount: 1 } })).rejects.toThrow()
      await expect(repository.findByCode(inventoryId, '00001')).resolves.toMatchObject({ descripcion: 'Uno' })
    })
  })
}

sharedMasterContract('Dexie master repository', () => new DexieMasterSkuRepository(new Inven3WebDatabase()))
sharedMasterContract('SQLite master repository', () => new SqliteMasterSkuRepository(new FakeSqliteDatabase()))

describe('certificación y migración del snapshot local', () => {
  it('no reemplaza la copia local si las filas remotas no corresponden al fingerprint publicado', async () => {
    const local = new DexieMasterSkuRepository(new Inven3WebDatabase())
    const previous = await createSnapshot()
    await local.replaceSnapshot(previous)
    const differentItems = [{ ...snapshotItems[0]!, descripcion: 'Contenido alterado' }, snapshotItems[1]!]
    const remote = new ScriptedMasterRepository({ items: differentItems, metadata: previous.metadata })
    await expect(refreshMasterSnapshot(inventoryId, remote, local)).rejects.toThrow('El maestro remoto no coincide con su metadata.')
    await expect(local.findByCode(inventoryId, '00001')).resolves.toMatchObject({ descripcion: 'Uno' })
  })

  it('no reemplaza la copia local si metadata cambia durante la descarga', async () => {
    const local = new DexieMasterSkuRepository(new Inven3WebDatabase())
    const previous = await createSnapshot()
    await local.replaceSnapshot(previous)
    const downloaded = await createSnapshot(2)
    const changedMetadata = { ...downloaded.metadata, masterVersion: 3 }
    const remote = new ScriptedMasterRepository({ items: downloaded.items, metadata: downloaded.metadata }, changedMetadata)
    await expect(refreshMasterSnapshot(inventoryId, remote, local)).rejects.toThrow('El maestro cambió durante la descarga. Intente actualizar nuevamente.')
    await expect(local.getMetadata(inventoryId)).resolves.toMatchObject({ masterVersion: 1 })
  })

  it('migra una base nueva de v0 a v5', async () => {
    const database = new FakeSqliteDatabase(0)
    await applySqliteMigrations(database)
    expect(database.userVersion).toBe(5)
    expect(database.appliedVersions).toEqual([1, 2, 3, 4, 5])
  })

  it('migra una base v3 a v5 sin repetir migraciones aprobadas', async () => {
    const database = new FakeSqliteDatabase(3)
    await applySqliteMigrations(database)
    expect(database.userVersion).toBe(5)
    expect(database.appliedVersions).toEqual([4, 5])
  })

  it('no modifica una base v5', async () => {
    const database = new FakeSqliteDatabase(5)
    await applySqliteMigrations(database)
    expect(database.appliedVersions).toEqual([])
  })

  it('conserva la versión anterior si una migración falla', async () => {
    const database = new FakeSqliteDatabase(1, true)
    await expect(applySqliteMigrations(database)).rejects.toThrow('Fallo de migración simulado')
    expect(database.userVersion).toBe(1)
  })

  it('rechaza de forma controlada una base de una versión futura', async () => {
    await expect(applySqliteMigrations(new FakeSqliteDatabase(SQLITE_MIGRATIONS.length + 1))).rejects.toThrow('requiere una versión más reciente')
  })
})

class ScriptedMasterRepository implements MasterSkuRepository {
  private metadataReads = 0
  public constructor(private readonly snapshot: MasterSnapshot, private readonly finalMetadata = snapshot.metadata) {}
  public async findByCode(): Promise<null> { return null }
  public async listByInventory() { return this.snapshot.items }
  public async getMetadata() { this.metadataReads += 1; return this.metadataReads === 1 ? this.snapshot.metadata : this.finalMetadata }
  public async replaceSnapshot(): Promise<void> { throw new Error('Not implemented for remote test double') }
}

class FakeSqliteDatabase implements SqliteDatabase {
  private skuRows: Array<{ inventory_id: string; codigo: string; descripcion: string; control_type: string; cached_at: string }> = []
  private metadataRows: Array<{ inventory_id: string; master_version: number; row_count: number; fingerprint: string; cached_at: string }> = []
  public appliedVersions: number[] = []
  public constructor(public userVersion = 0, private readonly failMasterMigration = false) {}
  public async initialize(): Promise<void> {}
  public async close(): Promise<void> {}
  public async transaction<T>(operation: () => Promise<T>): Promise<T> {
    const skuBefore = [...this.skuRows]; const metadataBefore = [...this.metadataRows]; const versionBefore = this.userVersion
    try { return await operation() } catch (error: unknown) { this.skuRows = skuBefore; this.metadataRows = metadataBefore; this.userVersion = versionBefore; throw error }
  }
  public async execute(statement: string, values: readonly unknown[] = []): Promise<void> {
    if (statement.startsWith('pragma user_version =')) { this.userVersion = Number(statement.split('=').at(-1)); this.appliedVersions.push(this.userVersion); return }
    if (statement.startsWith('create table if not exists inven3_master') && this.failMasterMigration) throw new Error('Fallo de migración simulado')
    if (statement.startsWith('delete from inven3_master_sku')) { this.skuRows = this.skuRows.filter((row) => row.inventory_id !== values[0]); return }
    if (statement.startsWith('insert into inven3_master_sku')) { this.skuRows.push({ inventory_id: String(values[0]), codigo: String(values[1]), descripcion: String(values[2]), control_type: String(values[3]), cached_at: String(values[4]) }); return }
    if (statement.startsWith('insert into inven3_master_metadata')) {
      const next = { inventory_id: String(values[0]), master_version: Number(values[1]), row_count: Number(values[2]), fingerprint: String(values[3]), cached_at: String(values[4]) }
      this.metadataRows = [...this.metadataRows.filter((row) => row.inventory_id !== next.inventory_id), next]
    }
  }
  public async query<Row extends Record<string, unknown>>(statement: string, values: readonly unknown[] = []): Promise<SqliteResult<Row>> {
    if (statement === 'pragma user_version') return { values: [{ user_version: this.userVersion }] as unknown as Row[] }
    const rows = statement.includes('inven3_master_metadata') ? this.metadataRows.filter((row) => row.inventory_id === values[0]) : this.skuRows.filter((row) => row.inventory_id === values[0] && (!statement.includes('and codigo') || row.codigo === values[1]))
    return { values: rows.map((row) => ({ ...row })) as unknown as Row[] }
  }
}
