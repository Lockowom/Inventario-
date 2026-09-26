import { describe, expect, it, vi } from 'vitest'

const fakes = vi.hoisted(() => {
  let transactionActive = false
  const connection = {
    open: vi.fn(async () => undefined),
    close: vi.fn(async () => undefined),
    beginTransaction: vi.fn(async () => { transactionActive = true; return { changes: { changes: 0 } } }),
    commitTransaction: vi.fn(async () => { transactionActive = false; return { changes: { changes: 0 } } }),
    rollbackTransaction: vi.fn(async () => { transactionActive = false; return { changes: { changes: 0 } } }),
    isTransactionActive: vi.fn(async () => ({ result: transactionActive })),
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

  it('uses the plugin managed transaction API and disables per-statement auto-transactions', async () => {
    const database = new CapacitorSqliteDatabase('inven3')
    await database.initialize()

    await database.transaction(async () => {
      await database.execute('create table example (id text)')
      await database.execute('insert into example (id) values (?)', ['one'])
    })

    expect(fakes.connection.beginTransaction).toHaveBeenCalledTimes(1)
    expect(fakes.connection.commitTransaction).toHaveBeenCalledTimes(1)
    expect(fakes.connection.rollbackTransaction).not.toHaveBeenCalled()
    expect(fakes.connection.execute).toHaveBeenCalledWith('create table example (id text)', false)
    expect(fakes.connection.run).toHaveBeenCalledWith('insert into example (id) values (?)', ['one'], false)
  })

  it('rolls back through the managed API and serializes concurrent transactions', async () => {
    const database = new CapacitorSqliteDatabase('inven3')
    await database.initialize()
    const order: string[] = []

    const first = database.transaction(async () => {
      order.push('first-start')
      await new Promise((resolve) => setTimeout(resolve, 5))
      order.push('first-end')
    })
    const second = database.transaction(async () => {
      order.push('second-start')
      order.push('second-end')
    })
    await Promise.all([first, second])
    expect(order).toEqual(['first-start', 'first-end', 'second-start', 'second-end'])

    await expect(database.transaction(async () => { throw new Error('boom') })).rejects.toThrow('boom')
    expect(fakes.connection.rollbackTransaction).toHaveBeenCalledTimes(1)
  })
})
