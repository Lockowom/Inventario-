import { CapacitorSQLite, SQLiteConnection, type SQLiteDBConnection } from '@capacitor-community/sqlite'
import type { SqliteDatabase, SqliteResult } from './sqlite-database'

export class CapacitorSqliteDatabase implements SqliteDatabase {
  private connection: SQLiteDBConnection | undefined
  private initialization: Promise<void> | undefined
  private readonly sqlite = new SQLiteConnection(CapacitorSQLite)

  public constructor(private readonly databaseName: string) {}

  public async initialize(): Promise<void> {
    if (this.connection) return
    this.initialization ??= this.openConnection().finally(() => { this.initialization = undefined })
    await this.initialization
  }

  public async transaction<T>(operation: () => Promise<T>): Promise<T> {
    const connection = this.requireConnection()
    await connection.execute('BEGIN IMMEDIATE')
    try {
      const result = await operation()
      await connection.execute('COMMIT')
      return result
    } catch (error: unknown) {
      await connection.execute('ROLLBACK')
      throw error
    }
  }

  public async execute(statement: string, values: readonly unknown[] = []): Promise<void> {
    await this.requireConnection().run(statement, [...values])
  }

  public async query<Row extends Record<string, unknown>>(statement: string, values: readonly unknown[] = []): Promise<SqliteResult<Row>> {
    const result = await this.requireConnection().query(statement, [...values])
    return { values: (result.values ?? []) as Row[] }
  }

  public async close(): Promise<void> {
    if (this.initialization) await this.initialization.catch(() => undefined)
    if (!this.connection) return
    await this.connection.close()
    await this.sqlite.closeConnection(this.databaseName, false)
    this.connection = undefined
  }

  private async openConnection(): Promise<void> {
    const consistency = await this.sqlite.checkConnectionsConsistency()
    if (!consistency.result) await this.sqlite.closeAllConnections()
    const connection = await this.sqlite.createConnection(this.databaseName, false, 'no-encryption', 1, false)
    try {
      await connection.open()
      this.connection = connection
    } catch (error: unknown) {
      await this.sqlite.closeConnection(this.databaseName, false).catch(() => undefined)
      throw error
    }
  }

  private requireConnection(): SQLiteDBConnection {
    if (!this.connection) throw new Error('SQLite no está inicializada.')
    return this.connection
  }
}
