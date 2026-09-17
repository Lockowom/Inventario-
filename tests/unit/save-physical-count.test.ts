import { describe, expect, it } from 'vitest'
import { savePhysicalCount } from '../../src/domain/count/save-physical-count'
import type { LocalCountRecord, PhysicalCountDraft } from '../../src/domain/count/contracts'
import { PendingCountCapacityError, type CountListFilter, type CountRepository } from '../../src/domain/ports/count-repository'
import type { MasterSkuRepository } from '../../src/domain/ports/master-sku-repository'

const inventoryId = '11111111-1111-4111-8111-111111111111'
const userId = '22222222-2222-4222-8222-222222222222'
const deviceId = '33333333-3333-4333-8333-333333333333'
const draft: PhysicalCountDraft = { ubicacion: 'F-32-03', codigo: '00001', partida: '000045', cantidadContada: '2' }
const master: MasterSkuRepository = {
  findByCode: async () => ({ inventoryId, codigo: '00001', descripcion: 'Producto local', controlType: 'PARTIDA', cachedAt: '2026-09-16T00:00:00.000Z' }),
  listByInventory: async () => [], getMetadata: async () => null, replaceSnapshot: async () => undefined,
}

class MemoryCountRepository implements CountRepository {
  public records: LocalCountRecord[] = []
  public failSave = false
  private queued = Promise.resolve()
  public async getOrCreateDeviceId() { return deviceId }
  public async save(record: LocalCountRecord) { if (this.failSave) throw new Error('almacenamiento no disponible'); this.records.push(record); return record }
  public async savePendingWithCapacity(record: LocalCountRecord, maxPending: number) {
    let release: (() => void) | undefined
    const previous = this.queued
    this.queued = new Promise<void>((resolve) => { release = resolve })
    await previous
    try {
      if (this.failSave) throw new Error('almacenamiento no disponible')
      const pending = await this.countPendingByDevice(record.deviceId)
      if (pending >= maxPending) throw new PendingCountCapacityError(maxPending)
      this.records.push(record)
      return { record, pending: pending + 1 }
    } finally { release!() }
  }
  public async findByClientId(id: string) { return this.records.find((record) => record.clientCountId === id) ?? null }
  public async listOwnCounts(filter: CountListFilter) { return this.records.filter((record) => record.inventoryId === filter.inventoryId && record.userId === filter.userId) }
  public async countPendingByDevice(id: string) { return this.records.filter((record) => record.deviceId === id && record.syncStatus === 'PENDING').length }
}

describe('guardado offline de conteo físico', () => {
  it('asigna UUID de cliente antes de persistir y conserva captura, lote y estado PENDING', async () => {
    const counts = new MemoryCountRepository()
    const uuids = ['44444444-4444-4444-8444-444444444444', '55555555-5555-4555-8555-555555555555']
    const result = await savePhysicalCount({ inventoryId, userId, inventoryStatus: 'ABIERTO' }, draft, { masters: master, counts, now: () => new Date('2026-09-16T12:00:00.000Z'), createUuid: () => uuids.shift()! })
    expect(result.record).toMatchObject({ id: '44444444-4444-4444-8444-444444444444', clientCountId: '55555555-5555-4555-8555-555555555555', deviceId, partida: '000045', capturedAt: '2026-09-16T12:00:00.000Z', syncStatus: 'PENDING' })
    expect(counts.records).toHaveLength(1)
  })

  it('no reporta éxito ni pierde el borrador cuando la transacción local falla', async () => {
    const counts = new MemoryCountRepository(); counts.failSave = true
    await expect(savePhysicalCount({ inventoryId, userId, inventoryStatus: 'ABIERTO' }, draft, { masters: master, counts, createUuid: () => '44444444-4444-4444-8444-444444444444' })).rejects.toThrow('almacenamiento no disponible')
    expect(counts.records).toEqual([])
  })

  it('bloquea exactamente al llegar a 50 pendientes y no elimina registros', async () => {
    const counts = new MemoryCountRepository()
    counts.records = Array.from({ length: 50 }, (_, index) => ({ id: `44444444-4444-4444-8444-${String(index).padStart(12, '0')}`, clientCountId: `55555555-5555-4555-8555-${String(index).padStart(12, '0')}`, inventoryId, userId, deviceId, ubicacion: 'F-32-03', codigo: '00001', serie: null, partida: '000045', piezaProducto: null, fechaVencimiento: null, talla: null, color: null, cantidadContada: 1, descripcion: 'Producto local', controlType: 'PARTIDA' as const, capturedAt: '2026-09-16T12:00:00.000Z', createdAt: '2026-09-16T12:00:00.000Z', syncStatus: 'PENDING' as const, syncAttempts: 0, lastSyncError: null }))
    await expect(savePhysicalCount({ inventoryId, userId, inventoryStatus: 'ABIERTO' }, draft, { masters: master, counts })).rejects.toThrow('límite de 50')
    expect(counts.records).toHaveLength(50)
  })

  it('serializa dos guardados concurrentes desde 49: exactamente uno llega a 50', async () => {
    const counts = new MemoryCountRepository()
    counts.records = Array.from({ length: 49 }, (_, index) => ({ id: `44444444-4444-4444-8444-${String(index).padStart(12, '0')}`, clientCountId: `55555555-5555-4555-8555-${String(index).padStart(12, '0')}`, inventoryId, userId, deviceId, ubicacion: 'F-32-03', codigo: '00001', serie: null, partida: '000045', piezaProducto: null, fechaVencimiento: null, talla: null, color: null, cantidadContada: 1, descripcion: 'Producto local', controlType: 'PARTIDA' as const, capturedAt: '2026-09-16T12:00:00.000Z', createdAt: '2026-09-16T12:00:00.000Z', syncStatus: 'PENDING' as const, syncAttempts: 0, lastSyncError: null }))
    const run = () => savePhysicalCount({ inventoryId, userId, inventoryStatus: 'ABIERTO' }, draft, { masters: master, counts })
    const [first, second] = await Promise.allSettled([run(), run()])
    expect([first, second].filter((result) => result.status === 'fulfilled')).toHaveLength(1)
    expect([first, second].filter((result) => result.status === 'rejected')).toHaveLength(1)
    expect(await counts.countPendingByDevice(deviceId)).toBe(50)
  })
})
