import { describe, expect, it } from 'vitest'
import { DexieLocalHealthProbe } from '../../src/storage/web-indexeddb/dexie-local-health-probe'
import { Inven3WebDatabase } from '../../src/storage/web-indexeddb/inven3-web-database'
import { SqliteLocalHealthProbe } from '../../src/storage/mobile-sqlite/sqlite-local-health-probe'
import type { SqliteDatabase, SqliteResult } from '../../src/storage/mobile-sqlite/sqlite-database'
import { applySqliteMigrations } from '../../src/storage/mobile-sqlite/sqlite-migrations'

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

  it('serializes concurrent migration runs for the same SQLite database', async () => {
    const database = new MigrationRaceDatabase()
    const up = vi.fn(async (db: SqliteDatabase) => {
      await new Promise((resolve) => setTimeout(resolve, 5))
      await db.execute('create table race_guard (id integer)')
    })
    const migrations = [{ version: 1, up }]

    await Promise.all([
      applySqliteMigrations(database, migrations),
      applySqliteMigrations(database, migrations),
      applySqliteMigrations(database, migrations),
    ])

    expect(up).toHaveBeenCalledTimes(1)
    expect(database.transactions).toBe(1)
    expect(database.userVersion).toBe(1)
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


class MigrationRaceDatabase implements SqliteDatabase {
  public userVersion = 0
  public transactions = 0
  public async initialize() {}
  public async close() {}
  public async transaction<T>(operation: () => Promise<T>) {
    this.transactions += 1
    return operation()
  }
  public async execute(statement: string): Promise<void> {
    const match = statement.match(/^pragma user_version = (\d+)$/)
    if (match) this.userVersion = Number(match[1])
  }
  public async query<Row extends Record<string, unknown>>(statement: string): Promise<SqliteResult<Row>> {
    if (statement === 'pragma user_version') return { values: [{ user_version: this.userVersion }] as unknown as Row[] }
    return { values: [] }
  }
}
