import { CapacitorSQLite, SQLiteConnection, type SQLiteDBConnection } from '@capacitor-community/sqlite'
import type { SqliteDatabase, SqliteResult } from './sqlite-database'

export class CapacitorSqliteDatabase implements SqliteDatabase {
  private connection: SQLiteDBConnection | undefined
  private initialization: Promise<void> | undefined
  private transactionTail: Promise<void> = Promise.resolve()
  private readonly sqlite = new SQLiteConnection(CapacitorSQLite)

  public constructor(private readonly databaseName: string) {}

  public async initialize(): Promise<void> {
    if (this.connection) return
    this.initialization ??= this.openConnection().finally(() => { this.initialization = undefined })
    await this.initialization
  }

  public async transaction<T>(operation: () => Promise<T>): Promise<T> {
    const previous = this.transactionTail
    let release!: () => void
    this.transactionTail = new Promise<void>((resolve) => { release = resolve })

    await previous
    const connection = this.requireConnection()

    try {
      await connection.beginTransaction()
      const result = await operation()
      await connection.commitTransaction()
      return result
    } catch (error: unknown) {
      try {
        const active = await connection.isTransactionActive()
        if (active.result) await connection.rollbackTransaction()
      } catch {
        // Preserve the original transaction failure.
      }
      throw error
    } finally {
      release()
    }
  }

  public async execute(statement: string, values: readonly unknown[] = []): Promise<void> {
    const connection = this.requireConnection()
    if (values.length > 0) {
      await connection.run(statement, [...values], false)
      return
    }
    await connection.execute(statement, false)
  }

  public async query<Row extends Record<string, unknown>>(statement: string, values: readonly unknown[] = []): Promise<SqliteResult<Row>> {
    const result = await this.requireConnection().query(statement, [...values])
    return { values: (result.values ?? []) as Row[] }
  }

  public async close(): Promise<void> {
    if (this.initialization) await this.initialization.catch(() => undefined)
    await this.transactionTail.catch(() => undefined)
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
