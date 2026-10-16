import { beforeEach, describe, expect, it, vi } from 'vitest'
import { recountOfflineOutbox } from '../../src/features/reconciliation/recount-offline-outbox'

describe('C2 offline outbox', () => {
  beforeEach(() => { localStorage.clear(); recountOfflineOutbox.setActor('counter-a') })

  it('rechaza una serie repetida antes de intentar sincronizar', () => {
    recountOfflineOutbox.enqueue({ kind: 'RECORD', missionId: 'm1', subtaskId: 's1', location: 'TECHO', quantity: 1, serial: 'P2500817', batch: null, logisticUnit: null })
    expect(() => recountOfflineOutbox.enqueue({ kind: 'RECORD', missionId: 'm1', subtaskId: 's1', location: 'TECHO', quantity: 1, serial: 'P2500817', batch: null, logisticUnit: null })).toThrow('SERIE YA ESCANEADA EN ESTE BARRIDO')
  })

  it('conserva un resultado sin red y lo reintenta contra el repositorio', async () => {
    recountOfflineOutbox.enqueue({ kind: 'RESOLVE', missionId: 'm1', subtaskId: 's1', status: 'ZERO_CONFIRMED', reason: null })
    const resolveSubtask = vi.fn(async () => ({ id: 'm1' }))
    await recountOfflineOutbox.flush({ resolveSubtask } as never, 'm1')
    expect(resolveSubtask).toHaveBeenCalledWith('s1', 'ZERO_CONFIRMED', undefined)
    expect(recountOfflineOutbox.list()).toEqual([])
  })

  it('aísla evidencia y misión cacheada entre usuarios del mismo dispositivo', () => {
    recountOfflineOutbox.enqueue({ kind: 'RECORD', missionId: 'm-a', subtaskId: 's-a', location: 'A-01-01', quantity: 1, serial: null, batch: null, logisticUnit: null })
    recountOfflineOutbox.cacheMission({ id: 'm-a', round: 3, reference_value: 'LOTE-QUE-NO-DEBE-QUEDAR', inventory_id: 'i', case_id: 'c', status: 'ACTIVE', codigo: 'SKU', descripcion: 'Producto', reference_type: 'PARTIDA', known_locations: [], observations: [] })
    expect(recountOfflineOutbox.cachedMission()?.reference_value).toBeNull()

    recountOfflineOutbox.setActor('counter-b')
    expect(recountOfflineOutbox.list()).toEqual([])
    expect(recountOfflineOutbox.cachedMission()).toBeNull()

    recountOfflineOutbox.setActor('counter-a')
    expect(recountOfflineOutbox.list()).toHaveLength(1)
    expect(recountOfflineOutbox.cachedMission()?.id).toBe('m-a')
  })
})
