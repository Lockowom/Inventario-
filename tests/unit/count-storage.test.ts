import { describe, expect, it } from 'vitest'
import type { LocalCountRecord } from '../../src/domain/count/contracts'
import type { CountRepository } from '../../src/domain/ports/count-repository'
import { SqliteCountRepository } from '../../src/storage/mobile-sqlite/sqlite-count-repository'
import type { SqliteDatabase, SqliteResult } from '../../src/storage/mobile-sqlite/sqlite-database'
import { DexieCountRepository } from '../../src/storage/web-indexeddb/dexie-count-repository'
import { Inven3WebDatabase } from '../../src/storage/web-indexeddb/inven3-web-database'

const inventoryId = '11111111-1111-4111-8111-111111111111'
const userId = '22222222-2222-4222-8222-222222222222'
const record: LocalCountRecord = { id: '44444444-4444-4444-8444-444444444444', clientCountId: '55555555-5555-4555-8555-555555555555', inventoryId, userId, deviceId: '33333333-3333-4333-8333-333333333333', ubicacion: 'F-32-03', codigo: '00001', serie: null, partida: '000045', piezaProducto: null, fechaVencimiento: null, talla: null, color: null, cantidadContada: 2, descripcion: 'Producto local', controlType: 'PARTIDA', capturedAt: '2026-09-16T12:00:00.000Z', createdAt: '2026-09-16T12:00:00.000Z', syncStatus: 'PENDING', syncAttempts: 0, lastSyncError: null }

function countContract(name: string, createRepository: () => CountRepository) {
  describe(name, () => {
    it('persiste, reabre, busca por UUID y conserva lote, cantidad y PENDING', async () => {
      const repository = createRepository()
      await repository.save(record)
      await expect(repository.findByClientId(record.clientCountId)).resolves.toMatchObject({ partida: '000045', cantidadContada: 2, syncStatus: 'PENDING' })
      await expect(repository.listOwnCounts({ inventoryId, userId, search: '000045' })).resolves.toHaveLength(1)
      await expect(repository.countPendingByDevice(record.deviceId)).resolves.toBe(1)
    })
  })
}

countContract('SQLite count repository', () => new SqliteCountRepository(new FakeCountSqlite()))
countContract('Dexie count repository', () => new DexieCountRepository(new Inven3WebDatabase(`inven3-count-${crypto.randomUUID()}`)))

describe('identidad persistente del dispositivo', () => {
  it('reutiliza la identidad SQLite después de reconstruir el repositorio', async () => {
    const database = new FakeCountSqlite()
    const first = await new SqliteCountRepository(database).getOrCreateDeviceId()
    const reopened = await new SqliteCountRepository(database).getOrCreateDeviceId()
    expect(reopened).toBe(first)
  })
})

class FakeCountSqlite implements SqliteDatabase {
  public userVersion = 0
  private deviceId: string | null = null
  private rows: Record<string, unknown>[] = []
  public async initialize() {}
  public async close() {}
  public async transaction<T>(operation: () => Promise<T>) { return operation() }
  public async execute(statement: string, values: readonly unknown[] = []) {
    if (statement.startsWith('pragma user_version =')) { this.userVersion = Number(statement.split('=').at(-1)); return }
    if (statement.startsWith("insert into local_device_identity")) { this.deviceId = String(values[0]); return }
    if (statement.startsWith('insert into local_count_records')) {
      const keys = ['id', 'client_count_id', 'inventory_id', 'user_id', 'device_id', 'ubicacion', 'codigo', 'serie', 'partida', 'pieza_producto', 'fecha_vencimiento', 'talla', 'color', 'cantidad_contada', 'descripcion', 'control_type', 'captured_at', 'created_at', 'sync_status', 'sync_attempts', 'last_sync_error']
      this.rows.push(Object.fromEntries(keys.map((key, index) => [key, values[index]])))
    }
  }
  public async query<Row extends Record<string, unknown>>(statement: string, values: readonly unknown[] = []): Promise<SqliteResult<Row>> {
    if (statement === 'pragma user_version') return { values: [{ user_version: this.userVersion }] as unknown as Row[] }
    if (statement.includes('local_device_identity')) return { values: this.deviceId ? [{ device_id: this.deviceId }] as unknown as Row[] : [] }
    let rows = [...this.rows]
    if (statement.includes('client_count_id =')) rows = rows.filter((row) => row.client_count_id === values[0])
    if (statement.includes('inventory_id = ? and user_id = ?')) rows = rows.filter((row) => row.inventory_id === values[0] && row.user_id === values[1])
    if (statement.includes("sync_status = 'PENDING'")) return { values: [{ total: rows.filter((row) => row.device_id === values[0] && row.sync_status === 'PENDING').length }] as unknown as Row[] }
    if (statement.includes('like ?')) { const search = String(values[2]).replaceAll('%', '').toUpperCase(); rows = rows.filter((row) => ['codigo', 'serie', 'partida', 'ubicacion'].some((key) => String(row[key] ?? '').toUpperCase().includes(search))) }
    return { values: rows as Row[] }
  }
}
