import { localCountRecordSchema, type LocalCountRecord } from '../../domain/count/contracts'
import { PendingCountCapacityError, type CountListFilter, type CountRepository, type OutstandingSyncScope, type SavedPendingCount } from '../../domain/ports/count-repository'
import type { LocalSyncAcknowledgement } from '../../domain/sync/contracts'
import { Inven3WebDatabase } from './inven3-web-database'

const isOutstanding = (status: LocalCountRecord['syncStatus']) => status === 'PENDING' || status === 'SYNCING' || status === 'FAILED'

export class DexieCountRepository implements CountRepository {
  public constructor(private readonly database: Inven3WebDatabase) {}

  public async getOrCreateDeviceId(userId: string): Promise<string> {
    const existing = await this.database.deviceRegistrations.get(userId)
    if (existing) return existing.deviceId
    const proposed = crypto.randomUUID()
    await this.database.transaction('rw', this.database.deviceRegistrations, this.database.localCountRecords, async () => {
      if (await this.database.deviceRegistrations.get(userId)) return
      const legacy = await this.database.localCountRecords.where('userId').equals(userId).first()
      await this.database.deviceRegistrations.put({ userId, deviceId: legacy?.deviceId ?? proposed, createdAt: new Date().toISOString() })
    })
    const created = await this.database.deviceRegistrations.get(userId)
    if (!created) throw new Error('No fue posible crear el registro local del dispositivo.')
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
      pending = await this.database.localCountRecords.where('deviceId').equals(valid.deviceId).filter((item) => isOutstanding(item.syncStatus)).count()
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
    return (await this.database.localCountRecords.where('deviceId').equals(deviceId).toArray()).filter((record) => isOutstanding(record.syncStatus)).length
  }

  public async listOutstandingSyncScopes(userId: string): Promise<OutstandingSyncScope[]> {
    const inventoryIds = new Set((await this.database.localCountRecords.where('userId').equals(userId).toArray())
      .filter((record) => isOutstanding(record.syncStatus)).map((record) => record.inventoryId))
    return [...inventoryIds].sort().map((inventoryId) => ({ inventoryId, userId }))
  }

  public async countOutstandingByInventoryDevice(inventoryId: string, deviceId: string): Promise<number> {
    return (await this.database.localCountRecords.where('deviceId').equals(deviceId).toArray())
      .filter((record) => record.inventoryId === inventoryId && isOutstanding(record.syncStatus)).length
  }

  public async claimNextSyncBatch(input: { inventoryId: string; userId: string; max: number; now: string; forceRetry?: boolean }): Promise<LocalCountRecord[]> {
    let claimed: LocalCountRecord[] = []
    await this.database.transaction('rw', this.database.localCountRecords, async () => {
      const candidates = (await this.database.localCountRecords.where('[inventoryId+userId]').equals([input.inventoryId, input.userId]).sortBy('capturedAt'))
        .filter((record) => record.syncStatus === 'PENDING' || (record.syncStatus === 'FAILED' && (input.forceRetry === true || !record.nextRetryAt || record.nextRetryAt <= input.now)))
        .slice(0, input.max)
      for (const record of candidates) await this.database.localCountRecords.update(record.clientCountId, { syncStatus: 'SYNCING', syncStartedAt: input.now, lastSyncError: null })
      claimed = candidates.map((record) => localCountRecordSchema.parse({ ...record, syncStatus: 'SYNCING', syncStartedAt: input.now, lastSyncError: null }))
    })
    return claimed
  }

  public async recoverStaleSyncing(input: { inventoryId: string; userId: string; before: string; now: string }): Promise<number> {
    let recovered = 0
    await this.database.transaction('rw', this.database.localCountRecords, async () => {
      const candidates = (await this.database.localCountRecords.where('[inventoryId+userId]').equals([input.inventoryId, input.userId]).toArray()).filter((record) => record.syncStatus === 'SYNCING' && record.syncStartedAt !== null && record.syncStartedAt <= input.before)
      for (const record of candidates) await this.database.localCountRecords.update(record.clientCountId, { syncStatus: 'FAILED', syncAttempts: record.syncAttempts + 1, syncStartedAt: null, nextRetryAt: input.now, lastSyncError: 'SYNC_RECOVERED_AFTER_CRASH', lastSyncAt: input.now })
      recovered = candidates.length
    })
    return recovered
  }

  public async applySyncAcknowledgements(acknowledgements: LocalSyncAcknowledgement[], now: string): Promise<void> {
    await this.database.transaction('rw', this.database.localCountRecords, async () => {
      for (const acknowledgement of acknowledgements) {
        const record = await this.database.localCountRecords.get(acknowledgement.clientCountId)
        if (!record || record.syncStatus !== 'SYNCING') continue
        await this.database.localCountRecords.update(acknowledgement.clientCountId, { syncStatus: acknowledgement.syncStatus, serverCountId: acknowledgement.serverCountId, confirmedAt: acknowledgement.syncStatus === 'CONFIRMED' ? acknowledgement.receivedAt ?? now : null, syncStartedAt: null, nextRetryAt: null, lastSyncError: acknowledgement.reason, lastSyncAt: now })
      }
    })
  }

  public async markSyncFailed(input: { clientCountIds: string[]; error: string; nextRetryAt: string; now: string }): Promise<void> {
    await this.database.transaction('rw', this.database.localCountRecords, async () => {
      for (const clientCountId of input.clientCountIds) {
        const record = await this.database.localCountRecords.get(clientCountId)
        if (record?.syncStatus === 'SYNCING') await this.database.localCountRecords.update(clientCountId, { syncStatus: 'FAILED', syncAttempts: record.syncAttempts + 1, syncStartedAt: null, nextRetryAt: input.nextRetryAt, lastSyncError: input.error, lastSyncAt: input.now })
      }
    })
  }
}
