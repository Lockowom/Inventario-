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

  it('preserva evidencia C3 revocada una vez y no entra en retry infinito', async () => {
    recountOfflineOutbox.enqueue({ kind: 'RECORD', missionId: 'm3', subtaskId: 's3', location: 'A-01-01', quantity: 1, serial: null, batch: null, logisticUnit: null })
    const recordSubtask = vi.fn(async () => { throw new Error('AUTHORIZATION_REVOKED') })
    await recountOfflineOutbox.flush({ recordSubtask } as never, 'm3')
    expect(recordSubtask).toHaveBeenCalledTimes(1)
    expect(recountOfflineOutbox.pendingForMission('m3')).toEqual([])
    expect(recountOfflineOutbox.reviewRequiredForMission('m3')).toMatchObject([{ missionId: 'm3', syncState: 'REVIEW_REQUIRED', reviewReason: 'AUTHORIZATION_REVOKED' }])
    await recountOfflineOutbox.flush({ recordSubtask } as never, 'm3')
    expect(recordSubtask).toHaveBeenCalledTimes(1)
  })

  it('recupera C3 tras reiniciar y conserva actor, versión y evidencia pendiente', () => {
    recountOfflineOutbox.cacheMission({ id: 'm3', round: 3, reference_value: 'SECRETO', inventory_id: 'i', case_id: 'c', status: 'ACTIVE', codigo: 'SKU', descripcion: 'Producto', reference_type: 'PARTIDA', known_locations: ['TECHO'], observations: [] })
    recountOfflineOutbox.enqueue({ kind: 'RECORD', missionId: 'm3', subtaskId: 's3', location: 'TECHO', quantity: 2, serial: null, batch: null, logisticUnit: null })

    // Simula cierre y recreación del store: localStorage persiste, la memoria no.
    recountOfflineOutbox.setActor(null)
    recountOfflineOutbox.setActor('counter-a')

    expect(recountOfflineOutbox.cachedMission()).toMatchObject({ id: 'm3', reference_value: null })
    expect(recountOfflineOutbox.cachedSnapshot()).toMatchObject({ actorId: 'counter-a', schemaVersion: 2 })
    expect(recountOfflineOutbox.list()).toHaveLength(1)
  })

  it('invalida un snapshot de versión anterior en vez de interpretarlo como permiso vigente', () => {
    localStorage.setItem('inven3.c2-2.mission:counter-a', JSON.stringify({ schemaVersion: 1, actorId: 'counter-a', mission: { id: 'old' }, verifiedAt: '2026-01-01T00:00:00Z' }))
    expect(recountOfflineOutbox.cachedMission()).toBeNull()
  })

  it('persiste un finding offline a través de reinicio, lo entrega al actor original una vez y no lo expone al siguiente usuario', async () => {
    const pending = recountOfflineOutbox.enqueue({ kind: 'FINDING', missionId: 'm2', subtaskId: 's2', finding: 'DAMAGED', note: 'Daño físico capturado offline' })

    // Simula destruir y recrear el estado de aplicación: sólo localStorage
    // sobrevive, y su clave está ligada al actor autenticado.
    recountOfflineOutbox.setActor(null)
    recountOfflineOutbox.setActor('counter-b')
    expect(recountOfflineOutbox.list()).toEqual([])

    recountOfflineOutbox.setActor('counter-a')
    expect(recountOfflineOutbox.list()).toMatchObject([{ id: pending.id, kind: 'FINDING', missionId: 'm2', subtaskId: 's2', finding: 'DAMAGED', note: 'Daño físico capturado offline' }])

    const reportFinding = vi.fn(async () => undefined)
    await recountOfflineOutbox.flush({ reportFinding } as never, 'm2')
    expect(reportFinding).toHaveBeenCalledTimes(1)
    expect(reportFinding).toHaveBeenCalledWith('s2', 'DAMAGED', 'Daño físico capturado offline')
    await recountOfflineOutbox.flush({ reportFinding } as never, 'm2')
    expect(reportFinding).toHaveBeenCalledTimes(1)
  })

  it('preserva finding revocado como REVIEW_REQUIRED y no lo reintenta después de reinicio', async () => {
    recountOfflineOutbox.enqueue({ kind: 'FINDING', missionId: 'm3', subtaskId: 's3', finding: 'WRONG_LOCATION', note: 'Ubicación cambió offline' })
    const reportFinding = vi.fn(async () => { throw new Error('AUTHORIZATION_REVOKED') })

    await recountOfflineOutbox.flush({ reportFinding } as never, 'm3')
    recountOfflineOutbox.setActor(null)
    recountOfflineOutbox.setActor('counter-a')

    expect(recountOfflineOutbox.reviewRequiredForMission('m3')).toMatchObject([{ kind: 'FINDING', missionId: 'm3', syncState: 'REVIEW_REQUIRED', reviewReason: 'AUTHORIZATION_REVOKED' }])
    await recountOfflineOutbox.flush({ reportFinding } as never, 'm3')
    expect(reportFinding).toHaveBeenCalledTimes(1)
  })

  it('preserva la evidencia del propietario anterior cuando la misión cambia de asignación offline', async () => {
    recountOfflineOutbox.enqueue({ kind: 'FINDING', missionId: 'm-stale', subtaskId: 's-stale', finding: 'WRONG_LOCATION', note: 'Evidencia capturada antes de reasignar' })
    const reportFinding = vi.fn(async () => { throw new Error('MISSION_ASSIGNMENT_CHANGED') })
    await recountOfflineOutbox.flush({ reportFinding } as never, 'm-stale')
    expect(recountOfflineOutbox.reviewRequiredForMission('m-stale')).toMatchObject([{ missionId: 'm-stale', syncState: 'REVIEW_REQUIRED', reviewReason: 'MISSION_ASSIGNMENT_CHANGED' }])
    recountOfflineOutbox.setActor('counter-b')
    expect(recountOfflineOutbox.reviewRequiredForMission('m-stale')).toEqual([])
    recountOfflineOutbox.setActor('counter-a')
    await recountOfflineOutbox.flush({ reportFinding } as never, 'm-stale')
    expect(reportFinding).toHaveBeenCalledTimes(1)
  })
})
