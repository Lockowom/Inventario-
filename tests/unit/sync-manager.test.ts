import { describe, expect, it } from 'vitest'
import type { LocalCountRecord } from '../../src/domain/count/contracts'
import type { CountListFilter, CountRepository } from '../../src/domain/ports/count-repository'
import type { LocalSyncAcknowledgement } from '../../src/domain/sync/contracts'
import { SyncManager, type CountSyncGateway } from '../../src/domain/sync/sync-manager'
import { SyncCoordinator } from '../../src/domain/sync/sync-coordinator'
import { SyncTransportError } from '../../src/domain/sync/transport-error'

const inventoryId = '11111111-1111-4111-8111-111111111111'
const userId = '22222222-2222-4222-8222-222222222222'
const deviceId = '33333333-3333-4333-8333-333333333333'
const serverId = '44444444-4444-4444-8444-444444444444'

function record(index: number): LocalCountRecord {
  const suffix = String(index).padStart(12, '0')
  return { id: `55555555-5555-4555-8555-${suffix}`, clientCountId: `66666666-6666-4666-8666-${suffix}`, inventoryId, userId, deviceId, ubicacion: 'F-32-03', codigo: '00001', serie: null, partida: '000045', piezaProducto: null, fechaVencimiento: null, talla: null, color: null, cantidadContada: 1, descripcion: 'Producto', controlType: 'PARTIDA', capturedAt: '2026-09-17T12:00:00.000Z', createdAt: '2026-09-17T12:00:00.000Z', syncStatus: 'PENDING', syncAttempts: 0, lastSyncError: null, syncStartedAt: null, nextRetryAt: null, confirmedAt: null, serverCountId: null, lastSyncAt: null }
}

class MemoryOutbox implements CountRepository {
  public constructor(public records: LocalCountRecord[]) {}
  public async getOrCreateDeviceId(userId: string) { void userId; return deviceId }
  public async save(item: LocalCountRecord) { this.records.push(item); return item }
  public async savePendingWithCapacity(item: LocalCountRecord) { this.records.push(item); return { record: item, pending: this.records.length } }
  public async findByClientId(id: string) { return this.records.find((item) => item.clientCountId === id) ?? null }
  public async listOwnCounts(filter: CountListFilter) { void filter; return this.records }
  public async listOutstandingSyncScopes(scopeUserId: string) { return [...new Set(this.records.filter((item) => item.userId === scopeUserId && item.syncStatus !== 'CONFIRMED' && item.syncStatus !== 'REJECTED').map((item) => item.inventoryId))].map((inventoryId) => ({ inventoryId, userId: scopeUserId })) }
  public async countPendingByDevice(id: string) { void id; return this.records.filter((item) => item.syncStatus !== 'CONFIRMED' && item.syncStatus !== 'REJECTED').length }
  public async countOutstandingByInventoryDevice(scopeInventoryId: string, id: string) { return this.records.filter((item) => item.inventoryId === scopeInventoryId && item.deviceId === id && item.syncStatus !== 'CONFIRMED' && item.syncStatus !== 'REJECTED').length }
  public async claimNextSyncBatch(input: { inventoryId: string; userId: string; max: number; now: string; forceRetry?: boolean }) {
    const claimed = this.records.filter((item) => item.inventoryId === input.inventoryId && item.userId === input.userId && (item.syncStatus === 'PENDING' || (item.syncStatus === 'FAILED' && (input.forceRetry === true || !item.nextRetryAt || item.nextRetryAt <= input.now)))).slice(0, input.max)
    for (const item of claimed) { item.syncStatus = 'SYNCING'; item.syncStartedAt = input.now; item.lastSyncError = null }
    return claimed.map((item) => ({ ...item }))
  }
  public async recoverStaleSyncing(input: { inventoryId: string; userId: string; before: string; now: string }) {
    const stale = this.records.filter((item) => item.inventoryId === input.inventoryId && item.userId === input.userId && item.syncStatus === 'SYNCING' && item.syncStartedAt !== null && item.syncStartedAt <= input.before)
    for (const item of stale) { item.syncStatus = 'FAILED'; item.syncAttempts += 1; item.syncStartedAt = null; item.nextRetryAt = input.now; item.lastSyncError = 'SYNC_RECOVERED_AFTER_CRASH' }
    return stale.length
  }
  public async applySyncAcknowledgements(items: LocalSyncAcknowledgement[], now: string) {
    for (const acknowledgement of items) { const item = this.records.find((record) => record.clientCountId === acknowledgement.clientCountId); if (item?.syncStatus === 'SYNCING') { item.syncStatus = acknowledgement.syncStatus; item.serverCountId = acknowledgement.serverCountId; item.confirmedAt = acknowledgement.syncStatus === 'CONFIRMED' ? acknowledgement.receivedAt : null; item.syncStartedAt = null; item.nextRetryAt = null; item.lastSyncError = acknowledgement.reason; item.lastSyncAt = now } }
  }
  public async markSyncFailed(input: { clientCountIds: string[]; error: string; nextRetryAt: string; now: string }) {
    for (const id of input.clientCountIds) { const item = this.records.find((record) => record.clientCountId === id); if (item?.syncStatus === 'SYNCING') { item.syncStatus = 'FAILED'; item.syncAttempts += 1; item.syncStartedAt = null; item.nextRetryAt = input.nextRetryAt; item.lastSyncError = input.error; item.lastSyncAt = input.now } }
  }
}

function gateway(respond: (records: LocalCountRecord[]) => unknown): CountSyncGateway & { calls: number } {
  return { calls: 0, registerDevice: async () => undefined, reportPending: async () => undefined, syncBatch: async ({ records }) => { gatewayInstance.calls += 1; return respond(records) } } as CountSyncGateway & { calls: number }
}
let gatewayInstance: CountSyncGateway & { calls: number }

describe('SyncManager', () => {
  it('procesa 47 registros en lotes 20/20/7 y confirma sólo tras ACK válido', async () => {
    const outbox = new MemoryOutbox(Array.from({ length: 47 }, (_, index) => record(index)))
    gatewayInstance = gateway((records) => records.map((item) => ({ client_count_id: item.clientCountId, result_status: 'ACCEPTED', server_count_id: serverId, received_at: '2026-09-17T13:00:00.000Z', reason: null })))
    const result = await new SyncManager({ inventoryId, userId }, outbox, gatewayInstance, () => new Date('2026-09-17T12:00:00.000Z')).run()
    expect(result).toMatchObject({ claimed: 47, confirmed: 47, failed: 0 })
    expect(gatewayInstance.calls).toBe(3)
    expect(outbox.records.every((item) => item.syncStatus === 'CONFIRMED' && item.confirmedAt !== null)).toBe(true)
  })

  it('acepta timestamps PostgreSQL con offset y los normaliza a UTC', async () => {
    const outbox = new MemoryOutbox([record(1)])
    gatewayInstance = gateway((records) => records.map((item) => ({
      client_count_id: item.clientCountId,
      result_status: 'ACCEPTED',
      server_count_id: serverId,
      received_at: '2026-09-17T13:00:00.123456+00:00',
      reason: null,
    })))

    const result = await new SyncManager({ inventoryId, userId }, outbox, gatewayInstance).run()

    expect(result).toMatchObject({ confirmed: 1, rejected: 0 })
    expect(outbox.records[0]).toMatchObject({
      syncStatus: 'CONFIRMED',
      confirmedAt: '2026-09-17T13:00:00.123Z',
      serverCountId: serverId,
    })
  })

  it('no confirma una respuesta parcial: deja el faltante REJECTED para revisión de contrato', async () => {
    const outbox = new MemoryOutbox([record(1), record(2)])
    gatewayInstance = gateway((records) => [{ client_count_id: records[0]!.clientCountId, result_status: 'ACCEPTED', server_count_id: serverId, received_at: '2026-09-17T13:00:00.000Z', reason: null }])
    await new SyncManager({ inventoryId, userId }, outbox, gatewayInstance, () => new Date('2026-09-17T12:00:00.000Z')).run()
    expect(outbox.records.map((item) => item.syncStatus)).toEqual(['CONFIRMED', 'REJECTED'])
  })

  it('convierte un CONFLICT de client_count_id en REJECTED local sin reescribirlo', async () => {
    const outbox = new MemoryOutbox([record(1)])
    gatewayInstance = gateway((records) => [{ client_count_id: records[0]!.clientCountId, result_status: 'CONFLICT', server_count_id: null, received_at: null, reason: 'CLIENT_COUNT_ID_PAYLOAD_CONFLICT' }])
    const result = await new SyncManager({ inventoryId, userId }, outbox, gatewayInstance).run()
    expect(result.conflicts).toBe(1)
    expect(outbox.records[0]).toMatchObject({ syncStatus: 'REJECTED', lastSyncError: 'CLIENT_COUNT_ID_PAYLOAD_CONFLICT' })
  })

  it('singleflight evita dos envíos concurrentes del mismo lote', async () => {
    const outbox = new MemoryOutbox([record(1)])
    gatewayInstance = gateway(async (records) => { await Promise.resolve(); return records.map((item) => ({ client_count_id: item.clientCountId, result_status: 'ACCEPTED', server_count_id: serverId, received_at: '2026-09-17T13:00:00.000Z', reason: null })) })
    const manager = new SyncManager({ inventoryId, userId }, outbox, gatewayInstance)
    await Promise.all([manager.run(), manager.run()])
    expect(gatewayInstance.calls).toBe(1)
  })

  it('reconcilia CERRADO desde el outbox sin CaptureRuntime', async () => {
    const outbox = new MemoryOutbox(Array.from({ length: 20 }, (_, index) => record(index)))
    gatewayInstance = gateway((records) => records.map((item) => ({ client_count_id: item.clientCountId, result_status: 'ACCEPTED', server_count_id: serverId, received_at: '2026-09-17T13:00:00.000Z', reason: null })))
    const coordinator = new SyncCoordinator(userId, outbox, gatewayInstance)
    const result = await coordinator.runOutstanding()
    expect(result).toMatchObject({ scopes: 1, confirmed: 20, rejected: 0 })
    expect(outbox.records.every((item) => item.syncStatus === 'CONFIRMED')).toBe(true)
  })

  it('42501 se vuelve REJECTED visible, sin borrar el payload ni reintentar', async () => {
    const outbox = new MemoryOutbox([record(1)])
    gatewayInstance = gateway(() => { throw new SyncTransportError('TERMINAL_AUTHORIZATION', 'SYNC_AUTHORIZATION_BLOCKED') })
    const result = await new SyncManager({ inventoryId, userId }, outbox, gatewayInstance).run()
    expect(result).toMatchObject({ rejected: 1, failed: 0, diagnostic: 'SYNC_AUTHORIZATION_BLOCKED' })
    expect(outbox.records[0]).toMatchObject({ syncStatus: 'REJECTED', lastSyncError: 'SYNC_AUTHORIZATION_BLOCKED', codigo: '00001', cantidadContada: 1 })
  })

  it('CONGELADO conserva el payload y expone el rechazo terminal del servidor', async () => {
    const outbox = new MemoryOutbox([record(1)])
    gatewayInstance = gateway((records) => records.map((item) => ({ client_count_id: item.clientCountId, result_status: 'REJECTED', server_count_id: null, received_at: null, reason: 'INVENTORY_FROZEN' })))
    const result = await new SyncManager({ inventoryId, userId }, outbox, gatewayInstance).run()
    expect(result).toMatchObject({ rejected: 1, failed: 0 })
    expect(outbox.records[0]).toMatchObject({ syncStatus: 'REJECTED', lastSyncError: 'INVENTORY_FROZEN', codigo: '00001' })
  })

  it('503 deja FAILED con próximo reintento futuro', async () => {
    const outbox = new MemoryOutbox([record(1)])
    const now = new Date('2026-09-17T12:00:00.000Z')
    gatewayInstance = gateway(() => { throw new SyncTransportError('TRANSIENT', 'SYNC_TRANSIENT_UNAVAILABLE') })
    const result = await new SyncManager({ inventoryId, userId }, outbox, gatewayInstance, () => now, () => 0.5).run()
    expect(result).toMatchObject({ failed: 1, rejected: 0, diagnostic: 'SYNC_TRANSIENT_UNAVAILABLE' })
    expect(outbox.records[0]).toMatchObject({ syncStatus: 'FAILED', syncAttempts: 1, lastSyncError: 'SYNC_TRANSIENT_UNAVAILABLE' })
    const retryAt = outbox.records[0]?.nextRetryAt
    expect(retryAt).toBeDefined()
    expect(retryAt !== null && retryAt !== undefined && retryAt > now.toISOString()).toBe(true)
  })

  it('auto-sync respeta backoff pero SINCRONIZAR AHORA fuerza reintento inmediato', async () => {
    const now = new Date('2026-09-17T12:00:00.000Z')
    const failed = {
      ...record(1),
      syncStatus: 'FAILED' as const,
      syncAttempts: 2,
      lastSyncError: 'SYNC_TRANSIENT_UNAVAILABLE',
      nextRetryAt: '2026-09-17T12:05:00.000Z',
    }
    const outbox = new MemoryOutbox([failed])
    gatewayInstance = gateway((records) => records.map((item) => ({
      client_count_id: item.clientCountId,
      result_status: 'ACCEPTED',
      server_count_id: serverId,
      received_at: '2026-09-17T12:00:10.000Z',
      reason: null,
    })))

    const automatic = await new SyncManager({ inventoryId, userId }, outbox, gatewayInstance, () => now).run()
    expect(automatic).toMatchObject({ claimed: 0, confirmed: 0 })
    expect(outbox.records[0]?.syncStatus).toBe('FAILED')

    const manual = await new SyncManager({ inventoryId, userId }, outbox, gatewayInstance, () => now).run({ forceRetry: true })
    expect(manual).toMatchObject({ claimed: 1, confirmed: 1, failed: 0 })
    expect(outbox.records[0]?.syncStatus).toBe('CONFIRMED')
  })

  it('reporta freeze guards sólo con pendientes de su inventario', async () => {
    const inventoryB = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa'
    const outbox = new MemoryOutbox([{ ...record(1), syncStatus: 'CONFIRMED' }, ...Array.from({ length: 5 }, (_, index) => ({ ...record(index + 2), inventoryId: inventoryB }))])
    const reports: Array<{ inventoryId: string; pendingCount: number }> = []
    const reportingGateway: CountSyncGateway = {
      registerDevice: async () => undefined,
      reportPending: async (input) => { reports.push({ inventoryId: input.inventoryId, pendingCount: input.pendingCount }) },
      syncBatch: async () => [],
    }
    await new SyncManager({ inventoryId, userId }, outbox, reportingGateway).announcePending()
    await new SyncManager({ inventoryId: inventoryB, userId }, outbox, reportingGateway).announcePending()
    expect(reports).toEqual([{ inventoryId, pendingCount: 0 }, { inventoryId: inventoryB, pendingCount: 5 }])
  })
})
