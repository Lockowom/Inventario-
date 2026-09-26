import { describe, expect, it } from 'vitest'
import { DexieLocalHealthProbe } from '../../src/storage/web-indexeddb/dexie-local-health-probe'
import { Inven3WebDatabase } from '../../src/storage/web-indexeddb/inven3-web-database'
import { SqliteLocalHealthProbe } from '../../src/storage/mobile-sqlite/sqlite-local-health-probe'
import type { SqliteDatabase, SqliteResult } from '../../src/storage/mobile-sqlite/sqlite-database'

describe('local health probes', () => {
  it('Dexie writes, reads and deletes only a transient runtime key', async () => {
    const database = new Inven3WebDatabase(`inven3-health-${crypto.randomUUID()}`)
    await database.runtimeState.put({ key: 'unrelated', value: 'preserved' })
    const result = await new DexieLocalHealthProbe(database).probe()
    expect(result).toMatchObject({ databaseOperational: true, persistenceOperational: true })
    expect(await database.runtimeState.get('unrelated')).toEqual({ key: 'unrelated', value: 'preserved' })
    expect((await database.runtimeState.toArray()).some((entry) => entry.key.startsWith('health_probe:'))).toBe(false)
    database.close(); await database.delete()
  })

  it('SQLite uses a temporary table and leaves user_version unchanged', async () => {
    const database = new ProbeSqliteDatabase()
    await expect(new SqliteLocalHealthProbe(database).probe()).resolves.toMatchObject({ databaseOperational: true, persistenceOperational: true, storageEstimate: null })
    expect(database.userVersion).toBe(5)
    expect(database.statements).toEqual(expect.arrayContaining([
      'pragma user_version', 'create temp table health_probe (marker text not null)', 'insert into health_probe (marker) values (?)',
      'select marker from health_probe', 'delete from health_probe', 'drop table health_probe',
    ]))
  })
})

class ProbeSqliteDatabase implements SqliteDatabase {
  public userVersion = 5
  public statements: string[] = []
  public async initialize() {}
  public async close() {}
  public async transaction<T>(operation: () => Promise<T>) { return operation() }
  public async execute(statement: string): Promise<void> { this.statements.push(statement) }
  public async query<Row extends Record<string, unknown>>(statement: string): Promise<SqliteResult<Row>> {
    this.statements.push(statement)
    if (statement === 'pragma user_version') return { values: [{ user_version: this.userVersion }] as unknown as Row[] }
    return { values: [{ marker: 'inven3-health-probe-v1' }] as unknown as Row[] }
  }
}
