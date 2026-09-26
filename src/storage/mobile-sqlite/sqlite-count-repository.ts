import { localCountRecordSchema, type LocalCountRecord } from '../../domain/count/contracts'
import { PendingCountCapacityError, type CountListFilter, type CountRepository, type OutstandingSyncScope, type SavedPendingCount } from '../../domain/ports/count-repository'
import type { LocalSyncAcknowledgement } from '../../domain/sync/contracts'
import type { SqliteDatabase } from './sqlite-database'
import { applySqliteMigrations } from './sqlite-migrations'

interface CountRow extends Record<string, unknown> {
  id: string; client_count_id: string; inventory_id: string; user_id: string; device_id: string; ubicacion: string; codigo: string; serie: string | null; partida: string | null; pieza_producto: string | null; fecha_vencimiento: string | null; talla: string | null; color: string | null; cantidad_contada: number; descripcion: string; control_type: LocalCountRecord['controlType']; captured_at: string; created_at: string; sync_status: LocalCountRecord['syncStatus']; sync_attempts: number; last_sync_error: string | null; sync_started_at?: string | null; next_retry_at?: string | null; confirmed_at?: string | null; server_count_id?: string | null; last_sync_at?: string | null
}
interface DeviceRow extends Record<string, unknown> { device_id: string }
interface TotalRow extends Record<string, unknown> { total: number }
interface ScopeRow extends Record<string, unknown> { inventory_id: string }

const INSERT_COUNT = 'insert into local_count_records (id, client_count_id, inventory_id, user_id, device_id, ubicacion, codigo, serie, partida, pieza_producto, fecha_vencimiento, talla, color, cantidad_contada, descripcion, control_type, captured_at, created_at, sync_status, sync_attempts, last_sync_error, sync_started_at, next_retry_at, confirmed_at, server_count_id, last_sync_at) values (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)'
const OUTSTANDING_STATUSES = "('PENDING', 'SYNCING', 'FAILED')"

export class SqliteCountRepository implements CountRepository {
  private initialized = false
  public constructor(private readonly database: SqliteDatabase) {}

  public async getOrCreateDeviceId(userId: string): Promise<string> {
    await this.initialize()
    const existing = await this.database.query<DeviceRow>('select device_id from local_device_registrations where user_id = ?', [userId])
    if (existing.values[0]) return existing.values[0].device_id
    const proposed = crypto.randomUUID()
    await this.database.transaction(async () => {
      const current = await this.database.query<DeviceRow>('select device_id from local_device_registrations where user_id = ?', [userId])
      if (current.values[0]) return
      // Preserve a v4 record's registration for its original user only.
      const legacy = await this.database.query<DeviceRow>('select device_id from local_count_records where user_id = ? order by created_at asc limit 1', [userId])
      await this.database.execute('insert into local_device_registrations (user_id, device_id, created_at) values (?, ?, ?)', [userId, legacy.values[0]?.device_id ?? proposed, new Date().toISOString()])
    })
    const created = await this.database.query<DeviceRow>('select device_id from local_device_registrations where user_id = ?', [userId])
    if (!created.values[0]) throw new Error('No fue posible crear el registro local del dispositivo.')
    return created.values[0].device_id
  }

  public async save(record: LocalCountRecord): Promise<LocalCountRecord> {
    await this.initialize()
    const valid = localCountRecordSchema.parse(record)
    await this.database.transaction(async () => { await this.database.execute(INSERT_COUNT, recordValues(valid)) })
    return valid
  }

  public async savePendingWithCapacity(record: LocalCountRecord, maxPending: number): Promise<SavedPendingCount> {
    await this.initialize()
    const valid = localCountRecordSchema.parse(record)
    if (valid.syncStatus !== 'PENDING') throw new Error('La capacidad local sólo se reserva para conteos PENDING.')
    let pending = 0
    await this.database.transaction(async () => {
      const result = await this.database.query<TotalRow>(`select count(*) as total from local_count_records where device_id = ? and sync_status in ${OUTSTANDING_STATUSES}`, [valid.deviceId])
      pending = Number(result.values[0]?.total ?? 0)
      if (pending >= maxPending) throw new PendingCountCapacityError(maxPending)
      await this.database.execute(INSERT_COUNT, recordValues(valid))
    })
    return { record: valid, pending: pending + 1 }
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
    const result = await this.database.query<TotalRow>(`select count(*) as total from local_count_records where device_id = ? and sync_status in ${OUTSTANDING_STATUSES}`, [deviceId])
    return Number(result.values[0]?.total ?? 0)
  }

  public async listOutstandingSyncScopes(userId: string): Promise<OutstandingSyncScope[]> {
    await this.initialize()
    const result = await this.database.query<ScopeRow>(`select distinct inventory_id from local_count_records where user_id = ? and sync_status in ${OUTSTANDING_STATUSES} order by inventory_id`, [userId])
    return result.values.map((row) => ({ inventoryId: row.inventory_id, userId }))
  }

  public async countOutstandingByInventoryDevice(inventoryId: string, deviceId: string): Promise<number> {
    await this.initialize()
    const result = await this.database.query<TotalRow>(`select count(*) as total from local_count_records where inventory_id = ? and device_id = ? and sync_status in ${OUTSTANDING_STATUSES}`, [inventoryId, deviceId])
    return Number(result.values[0]?.total ?? 0)
  }

  public async claimNextSyncBatch(input: { inventoryId: string; userId: string; max: number; now: string }): Promise<LocalCountRecord[]> {
    await this.initialize()
    let claimed: LocalCountRecord[] = []
    await this.database.transaction(async () => {
      const candidates = await this.database.query<CountRow>("select * from local_count_records where inventory_id = ? and user_id = ? and (sync_status = 'PENDING' or (sync_status = 'FAILED' and (next_retry_at is null or next_retry_at <= ?))) order by captured_at asc limit ?", [input.inventoryId, input.userId, input.now, input.max])
      for (const row of candidates.values) await this.database.execute("update local_count_records set sync_status = 'SYNCING', sync_started_at = ?, last_sync_error = null where client_count_id = ? and sync_status in ('PENDING', 'FAILED')", [input.now, row.client_count_id])
      claimed = candidates.values.map((row) => localCountRecordSchema.parse({ ...parseRow(row), syncStatus: 'SYNCING', syncStartedAt: input.now, lastSyncError: null }))
    })
    return claimed
  }

  public async recoverStaleSyncing(input: { inventoryId: string; userId: string; before: string; now: string }): Promise<number> {
    await this.initialize()
    const result = await this.database.query<TotalRow>("select count(*) as total from local_count_records where inventory_id = ? and user_id = ? and sync_status = 'SYNCING' and sync_started_at <= ?", [input.inventoryId, input.userId, input.before])
    const recovered = Number(result.values[0]?.total ?? 0)
    if (recovered) {
      await this.database.transaction(async () => {
        await this.database.execute("update local_count_records set sync_status = 'FAILED', sync_attempts = sync_attempts + 1, sync_started_at = null, next_retry_at = ?, last_sync_error = 'SYNC_RECOVERED_AFTER_CRASH', last_sync_at = ? where inventory_id = ? and user_id = ? and sync_status = 'SYNCING' and sync_started_at <= ?", [input.now, input.now, input.inventoryId, input.userId, input.before])
      })
    }
    return recovered
  }

  public async applySyncAcknowledgements(acknowledgements: LocalSyncAcknowledgement[], now: string): Promise<void> {
    await this.initialize()
    await this.database.transaction(async () => {
      for (const acknowledgement of acknowledgements) await this.database.execute("update local_count_records set sync_status = ?, server_count_id = ?, confirmed_at = case when ? = 'CONFIRMED' then ? else null end, sync_started_at = null, next_retry_at = null, last_sync_error = ?, last_sync_at = ? where client_count_id = ? and sync_status = 'SYNCING'", [acknowledgement.syncStatus, acknowledgement.serverCountId, acknowledgement.syncStatus, acknowledgement.receivedAt ?? now, acknowledgement.reason, now, acknowledgement.clientCountId])
    })
  }

  public async markSyncFailed(input: { clientCountIds: string[]; error: string; nextRetryAt: string; now: string }): Promise<void> {
    await this.initialize()
    await this.database.transaction(async () => {
      for (const id of input.clientCountIds) await this.database.execute("update local_count_records set sync_status = 'FAILED', sync_attempts = sync_attempts + 1, sync_started_at = null, next_retry_at = ?, last_sync_error = ?, last_sync_at = ? where client_count_id = ? and sync_status = 'SYNCING'", [input.nextRetryAt, input.error, input.now, id])
    })
  }

  private async initialize(): Promise<void> {
    if (this.initialized) return
    await this.database.initialize()
    await applySqliteMigrations(this.database)
    this.initialized = true
  }
}

function recordValues(record: LocalCountRecord): unknown[] {
  return [record.id, record.clientCountId, record.inventoryId, record.userId, record.deviceId, record.ubicacion, record.codigo, record.serie, record.partida, record.piezaProducto, record.fechaVencimiento, record.talla, record.color, record.cantidadContada, record.descripcion, record.controlType, record.capturedAt, record.createdAt, record.syncStatus, record.syncAttempts, record.lastSyncError, record.syncStartedAt, record.nextRetryAt, record.confirmedAt, record.serverCountId, record.lastSyncAt]
}

function parseRow(row: CountRow): LocalCountRecord {
  return localCountRecordSchema.parse({ id: row.id, clientCountId: row.client_count_id, inventoryId: row.inventory_id, userId: row.user_id, deviceId: row.device_id, ubicacion: row.ubicacion, codigo: row.codigo, serie: row.serie, partida: row.partida, piezaProducto: row.pieza_producto, fechaVencimiento: row.fecha_vencimiento, talla: row.talla, color: row.color, cantidadContada: row.cantidad_contada, descripcion: row.descripcion, controlType: row.control_type, capturedAt: row.captured_at, createdAt: row.created_at, syncStatus: row.sync_status, syncAttempts: row.sync_attempts, lastSyncError: row.last_sync_error, syncStartedAt: row.sync_started_at ?? null, nextRetryAt: row.next_retry_at ?? null, confirmedAt: row.confirmed_at ?? null, serverCountId: row.server_count_id ?? null, lastSyncAt: row.last_sync_at ?? null })
}
