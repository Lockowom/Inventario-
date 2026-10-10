import { beforeEach, describe, expect, it, vi } from 'vitest'
import { recountOfflineOutbox } from '../../src/features/reconciliation/recount-offline-outbox'

describe('C2 offline outbox', () => {
  beforeEach(() => localStorage.clear())

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
})
