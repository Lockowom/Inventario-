import { localCountRecordSchema, type LocalCountRecord } from '../../domain/count/contracts'
import type { CountListFilter, CountRepository } from '../../domain/ports/count-repository'
import type { SqliteDatabase } from './sqlite-database'
import { applySqliteMigrations } from './sqlite-migrations'

interface CountRow extends Record<string, unknown> {
  id: string; client_count_id: string; inventory_id: string; user_id: string; device_id: string; ubicacion: string; codigo: string; serie: string | null; partida: string | null; pieza_producto: string | null; fecha_vencimiento: string | null; talla: string | null; color: string | null; cantidad_contada: number; descripcion: string; control_type: LocalCountRecord['controlType']; captured_at: string; created_at: string; sync_status: LocalCountRecord['syncStatus']; sync_attempts: number; last_sync_error: string | null
}
interface DeviceRow extends Record<string, unknown> { device_id: string }
interface TotalRow extends Record<string, unknown> { total: number }

export class SqliteCountRepository implements CountRepository {
  private initialized = false
  public constructor(private readonly database: SqliteDatabase) {}

  public async getOrCreateDeviceId(): Promise<string> {
    await this.initialize()
    const existing = await this.database.query<DeviceRow>("select device_id from local_device_identity where identity_key = 'installation'")
    if (existing.values[0]) return existing.values[0].device_id
    const deviceId = crypto.randomUUID()
    await this.database.transaction(async () => {
      const current = await this.database.query<DeviceRow>("select device_id from local_device_identity where identity_key = 'installation'")
      if (!current.values[0]) await this.database.execute("insert into local_device_identity (identity_key, device_id, created_at) values ('installation', ?, ?)", [deviceId, new Date().toISOString()])
    })
    const created = await this.database.query<DeviceRow>("select device_id from local_device_identity where identity_key = 'installation'")
    if (!created.values[0]) throw new Error('No fue posible crear la identidad local del dispositivo.')
    return created.values[0].device_id
  }

  public async save(record: LocalCountRecord): Promise<LocalCountRecord> {
    await this.initialize()
    const valid = localCountRecordSchema.parse(record)
    await this.database.transaction(async () => {
      await this.database.execute('insert into local_count_records (id, client_count_id, inventory_id, user_id, device_id, ubicacion, codigo, serie, partida, pieza_producto, fecha_vencimiento, talla, color, cantidad_contada, descripcion, control_type, captured_at, created_at, sync_status, sync_attempts, last_sync_error) values (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)', [valid.id, valid.clientCountId, valid.inventoryId, valid.userId, valid.deviceId, valid.ubicacion, valid.codigo, valid.serie, valid.partida, valid.piezaProducto, valid.fechaVencimiento, valid.talla, valid.color, valid.cantidadContada, valid.descripcion, valid.controlType, valid.capturedAt, valid.createdAt, valid.syncStatus, valid.syncAttempts, valid.lastSyncError])
    })
    return valid
  }

  public async findByClientId(clientCountId: string): Promise<LocalCountRecord | null> {
    await this.initialize()
    const result = await this.database.query<CountRow>('select * from local_count_records where client_count_id = ?', [clientCountId])
    return result.values[0] ? parseRow(result.values[0]) : null
  }

  public async listOwnCounts(filter: CountListFilter): Promise<LocalCountRecord[]> {
    await this.initialize()
    const search = filter.search?.trim().toUpperCase()
    const statement = search ? "select * from local_count_records where inventory_id = ? and user_id = ? and (codigo like ? or serie like ? or partida like ? or ubicacion like ?) order by captured_at desc" : 'select * from local_count_records where inventory_id = ? and user_id = ? order by captured_at desc'
    const values = search ? [filter.inventoryId, filter.userId, `%${search}%`, `%${search}%`, `%${search}%`, `%${search}%`] : [filter.inventoryId, filter.userId]
    return (await this.database.query<CountRow>(statement, values)).values.map(parseRow)
  }

  public async countPendingByDevice(deviceId: string): Promise<number> {
    await this.initialize()
    const result = await this.database.query<TotalRow>("select count(*) as total from local_count_records where device_id = ? and sync_status = 'PENDING'", [deviceId])
    return Number(result.values[0]?.total ?? 0)
  }

  private async initialize(): Promise<void> {
    if (this.initialized) return
    await this.database.initialize()
    await applySqliteMigrations(this.database)
    this.initialized = true
  }
}

function parseRow(row: CountRow): LocalCountRecord {
  return localCountRecordSchema.parse({ id: row.id, clientCountId: row.client_count_id, inventoryId: row.inventory_id, userId: row.user_id, deviceId: row.device_id, ubicacion: row.ubicacion, codigo: row.codigo, serie: row.serie, partida: row.partida, piezaProducto: row.pieza_producto, fechaVencimiento: row.fecha_vencimiento, talla: row.talla, color: row.color, cantidadContada: row.cantidad_contada, descripcion: row.descripcion, controlType: row.control_type, capturedAt: row.captured_at, createdAt: row.created_at, syncStatus: row.sync_status, syncAttempts: row.sync_attempts, lastSyncError: row.last_sync_error })
}
