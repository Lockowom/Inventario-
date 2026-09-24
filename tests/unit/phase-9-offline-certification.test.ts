import { describe, expect, it } from 'vitest'
import type { LocalCountRecord } from '../../src/domain/count/contracts'
import { SyncManager, type CountSyncGateway } from '../../src/domain/sync/sync-manager'
import { SyncTransportError } from '../../src/domain/sync/transport-error'
import { DexieCountRepository } from '../../src/storage/web-indexeddb/dexie-count-repository'
import { Inven3WebDatabase } from '../../src/storage/web-indexeddb/inven3-web-database'
import { getCapacityStatus } from '../../src/features/counting/capacity-status'

const inventoryId = '11111111-1111-4111-8111-111111111111'
const userId = '22222222-2222-4222-8222-222222222222'
const deviceId = '33333333-3333-4333-8333-333333333333'

function record(index: number): LocalCountRecord {
  const suffix = String(index).padStart(12, '0')
  return { id: `44444444-4444-4444-8444-${suffix}`, clientCountId: `55555555-5555-4555-8555-${suffix}`, inventoryId, userId, deviceId, ubicacion: 'F-32-03', codigo: '00001', serie: null, partida: '00725', piezaProducto: null, fechaVencimiento: null, talla: null, color: null, cantidadContada: 1, descripcion: 'Fixture offline', controlType: 'PARTIDA', capturedAt: `2026-09-24T12:${String(index % 60).padStart(2, '0')}:00.000Z`, createdAt: '2026-09-24T12:00:00.000Z', syncStatus: 'PENDING', syncAttempts: 0, lastSyncError: null, syncStartedAt: null, nextRetryAt: null, confirmedAt: null, serverCountId: null, lastSyncAt: null }
}

function acceptingGateway(batches: number[]): CountSyncGateway {
  return {
    registerDevice: async () => undefined,
    reportPending: async () => undefined,
    syncBatch: async ({ records }) => {
      batches.push(records.length)
      return records.map((item) => ({ client_count_id: item.clientCountId, result_status: 'ACCEPTED', server_count_id: '66666666-6666-4666-8666-666666666666', received_at: '2026-09-24T13:00:00.000Z', reason: null }))
    },
  }
}

describe('F9 offline certification', () => {
  it('conserva 50 UUID a través de restart, soporta caída temporal y reconecta en 20+20+10', async () => {
    const name = `f9-offline-${crypto.randomUUID()}`
    const firstDatabase = new Inven3WebDatabase(name)
    const first = new DexieCountRepository(firstDatabase)
    await Promise.all(Array.from({ length: 50 }, (_, index) => first.savePendingWithCapacity(record(index), 50)))
    expect(await first.countPendingByDevice(deviceId)).toBe(50)
    const originalIds = (await first.listOwnCounts({ inventoryId, userId })).map((item) => item.clientCountId).sort()
    const unavailable: CountSyncGateway = { registerDevice: async () => undefined, reportPending: async () => undefined, syncBatch: async () => { throw new SyncTransportError('TRANSIENT', 'SYNC_TRANSIENT_UNAVAILABLE') } }
    const firstRun = await new SyncManager({ inventoryId, userId }, first, unavailable, () => new Date('2026-09-24T12:00:00.000Z'), () => 0).run()
    expect(firstRun).toMatchObject({ failed: 20, confirmed: 0, rejected: 0 })
    await firstDatabase.close()

    const reopenedDatabase = new Inven3WebDatabase(name)
    const reopened = new DexieCountRepository(reopenedDatabase)
    expect((await reopened.listOwnCounts({ inventoryId, userId })).map((item) => item.clientCountId).sort()).toEqual(originalIds)
    const batches: number[] = []
    const recovered = await new SyncManager({ inventoryId, userId }, reopened, acceptingGateway(batches), () => new Date('2026-09-24T13:00:00.000Z')).run()
    expect(recovered).toMatchObject({ confirmed: 50, rejected: 0, failed: 0 })
    expect(batches).toEqual([20, 20, 10])
    expect(await reopened.countPendingByDevice(deviceId)).toBe(0)
    expect((await reopened.listOwnCounts({ inventoryId, userId })).every((item) => item.syncStatus === 'CONFIRMED')).toBe(true)
    await reopenedDatabase.delete()
  })

  it('expone mensajes funcionales para 0–39, 40, 45 y 50 sin liberar pendientes', () => {
    expect(getCapacityStatus(39)).toMatchObject({ capacity: 'NORMAL', message: 'Pendientes: 39 / 50' })
    expect(getCapacityStatus(40)).toMatchObject({ capacity: 'WARNING', message: expect.stringContaining('Advertencia:') })
    expect(getCapacityStatus(45)).toMatchObject({ capacity: 'CRITICAL', message: expect.stringContaining('Advertencia crítica:') })
    expect(getCapacityStatus(50)).toMatchObject({ capacity: 'BLOCKED', message: expect.stringContaining('GUARDAR está bloqueado') })
  })
})
