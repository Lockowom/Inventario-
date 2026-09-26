import { describe, expect, it, vi } from 'vitest'

const fakes = vi.hoisted(() => {
  const connection = {
    open: vi.fn(async () => undefined),
    close: vi.fn(async () => undefined),
    execute: vi.fn(async () => ({ changes: { changes: 0 } })),
    run: vi.fn(async () => ({ changes: { changes: 0 } })),
    query: vi.fn(async () => ({ values: [] })),
  }
  return {
    connection,
    checkConnectionsConsistency: vi.fn(async () => ({ result: true })),
    closeAllConnections: vi.fn(async () => undefined),
    createConnection: vi.fn(async () => {
      await new Promise((resolve) => setTimeout(resolve, 5))
      return connection
    }),
    closeConnection: vi.fn(async () => undefined),
  }
})

vi.mock('@capacitor-community/sqlite', () => ({
  CapacitorSQLite: {},
  SQLiteConnection: class {
    public checkConnectionsConsistency = fakes.checkConnectionsConsistency
    public closeAllConnections = fakes.closeAllConnections
    public createConnection = fakes.createConnection
    public closeConnection = fakes.closeConnection
  },
}))

import { CapacitorSqliteDatabase } from '../../src/storage/mobile-sqlite/capacitor-sqlite-database'

describe('CapacitorSqliteDatabase initialization', () => {
  it('serializes concurrent initialization into one native connection', async () => {
    const database = new CapacitorSqliteDatabase('inven3')

    await Promise.all([
      database.initialize(),
      database.initialize(),
      database.initialize(),
    ])

    expect(fakes.checkConnectionsConsistency).toHaveBeenCalledTimes(1)
    expect(fakes.createConnection).toHaveBeenCalledTimes(1)
    expect(fakes.connection.open).toHaveBeenCalledTimes(1)
  })
})
