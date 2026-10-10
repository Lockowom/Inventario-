import { describe, expect, it } from 'vitest'
import { C2_SERIAL_POLICY, c3Consensus, canCompleteSubtasks, chooseSerialStrategy, requiresAnalystReview, serialSetsMatch, sortExecutionLocations, totalCompletedBatchQuantity } from '../../src/domain/reconciliation/c2-2-algorithm'

describe('C2 2.0 algoritmo híbrido', () => {
  it('centraliza los umbrales de series', () => {
    expect(C2_SERIAL_POLICY).toEqual({ sweepThreshold: 70, anomalyRatioThreshold: 0.20 })
  })

  it.each([[12, 1, 'TARGETED_SERIAL_SEARCH'], [69, 1, 'TARGETED_SERIAL_SEARCH'], [70, 0, 'SERIAL_SWEEP'], [500, 1, 'SERIAL_SWEEP'], [65, 25, 'SERIAL_SWEEP']] as const)(
    'elige %s series / %s anomalías como %s', (seriesAtLocation, anomaliesAtLocation, expected) => {
      expect(chooseSerialStrategy({ seriesAtLocation, anomaliesAtLocation })).toBe(expected)
    },
  )

  it('no permite cerrar mientras exista una subtarea pendiente o activa', () => {
    expect(canCompleteSubtasks([{ status: 'COUNTED' }, { status: 'PENDING' }])).toBe(false)
    expect(canCompleteSubtasks([{ status: 'ZERO_CONFIRMED' }, { status: 'ACTIVE' }])).toBe(false)
    expect(canCompleteSubtasks([{ status: 'COUNTED' }, { status: 'ZERO_CONFIRMED' }])).toBe(true)
  })

  it('mantiene cero en el total y eleva bloqueos a revisión', () => {
    const subtasks = [{ status: 'COUNTED' as const, countedQuantity: 14 }, { status: 'ZERO_CONFIRMED' as const, countedQuantity: 0 }, { status: 'INACCESSIBLE' as const, countedQuantity: null }]
    expect(totalCompletedBatchQuantity(subtasks)).toBe(14)
    expect(requiresAnalystReview(subtasks)).toBe(true)
  })

  it('aplica consenso C3 sin hacer que la tercera ronda gane por defecto', () => {
    expect(c3Consensus(9, 8, 9)).toBe('CONFIRM_C1')
    expect(c3Consensus(9, 8, 8)).toBe('CONFIRM_C2')
    expect(c3Consensus(9, 8, 7)).toBe('REVIEW_REQUIRED')
  })

  it('rechaza una sustitución de serie aunque la cantidad sea idéntica', () => {
    expect(serialSetsMatch(['A001', 'A002', 'A003', 'A004', 'A005'], ['A001', 'A002', 'A003', 'A004', 'B900'])).toBe(false)
    expect(serialSetsMatch(['A001', 'A002'], ['a002', 'A001'])).toBe(true)
  })

  it('ordena las ubicaciones de ejecución y deja TECHO al final', () => {
    expect(sortExecutionLocations(['TECHO', 'B-01-01', 'A-02-01', 'A-01-03', 'A-01-01', 'A-01-01'])).toEqual(['A-01-01', 'A-01-03', 'A-02-01', 'B-01-01', 'TECHO'])
  })
})
