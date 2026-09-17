import { localCountRecordSchema, type LocalCountRecord } from '../../domain/count/contracts'
import { PendingCountCapacityError, type CountListFilter, type CountRepository, type SavedPendingCount } from '../../domain/ports/count-repository'
import { Inven3WebDatabase } from './inven3-web-database'

export class DexieCountRepository implements CountRepository {
  public constructor(private readonly database: Inven3WebDatabase) {}

  public async getOrCreateDeviceId(): Promise<string> {
    const identity = await this.database.deviceIdentity.get('installation')
    if (identity) return identity.deviceId
    const deviceId = crypto.randomUUID()
    await this.database.transaction('rw', this.database.deviceIdentity, async () => {
      const current = await this.database.deviceIdentity.get('installation')
      if (!current) await this.database.deviceIdentity.put({ key: 'installation', deviceId, createdAt: new Date().toISOString() })
    })
    const created = await this.database.deviceIdentity.get('installation')
    if (!created) throw new Error('No fue posible crear la identidad local del dispositivo.')
    return created.deviceId
  }

  public async save(record: LocalCountRecord): Promise<LocalCountRecord> {
    const valid = localCountRecordSchema.parse(record)
    await this.database.transaction('rw', this.database.localCountRecords, async () => { await this.database.localCountRecords.add(valid) })
    return valid
  }

  public async savePendingWithCapacity(record: LocalCountRecord, maxPending: number): Promise<SavedPendingCount> {
    const valid = localCountRecordSchema.parse(record)
    if (valid.syncStatus !== 'PENDING') throw new Error('La capacidad local sólo se reserva para conteos PENDING.')
    let pending = 0
    await this.database.transaction('rw', this.database.localCountRecords, async () => {
      pending = await this.database.localCountRecords.where('deviceId').equals(valid.deviceId).filter((item) => item.syncStatus === 'PENDING').count()
      if (pending >= maxPending) throw new PendingCountCapacityError(maxPending)
      await this.database.localCountRecords.add(valid)
    })
    return { record: valid, pending: pending + 1 }
  }

  public async findByClientId(clientCountId: string): Promise<LocalCountRecord | null> {
    const record = await this.database.localCountRecords.get(clientCountId)
    return record ? localCountRecordSchema.parse(record) : null
  }

  public async listOwnCounts(filter: CountListFilter): Promise<LocalCountRecord[]> {
    const records = await this.database.localCountRecords.where('[inventoryId+userId]').equals([filter.inventoryId, filter.userId]).reverse().sortBy('capturedAt')
    const search = filter.search?.trim().toUpperCase()
    return records.filter((record) => !search || [record.codigo, record.serie, record.partida, record.ubicacion].some((value) => value?.toUpperCase().includes(search))).map((record) => localCountRecordSchema.parse(record))
  }

  public async countPendingByDevice(deviceId: string): Promise<number> {
    return (await this.database.localCountRecords.where('deviceId').equals(deviceId).toArray()).filter((record) => record.syncStatus === 'PENDING').length
  }
}
