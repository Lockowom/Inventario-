import { describe, expect, it } from 'vitest'
import {
  canAccessLiveMonitor,
  coverageStatusForReference,
  identityReconciliationStatus,
  liveMonitorEventTypeSchema,
  monitorMissionStatusSchema,
} from '../../src/domain/live-monitor/contracts'

describe('LIVE-01 monitor contracts', () => {
  it('keeps a system reference pending while C1 is open and materializes its identity-specific absence afterwards', () => {
    expect(coverageStatusForReference({ referenceType: 'SERIAL', systemAvailableQuantity: 1, physicalQuantity: 0, inventoryStatus: 'ABIERTO' })).toBe('PENDIENTE_DE_COBERTURA')
    expect(coverageStatusForReference({ referenceType: 'SERIAL', systemAvailableQuantity: 1, physicalQuantity: 0, inventoryStatus: 'ABIERTO', c1Completed: true })).toBe('SERIE_SISTEMA_NO_CONTADA')
    expect(coverageStatusForReference({ referenceType: 'SERIAL', systemAvailableQuantity: 1, physicalQuantity: 0, inventoryStatus: 'C1_COMPLETADO' })).toBe('SERIE_SISTEMA_NO_CONTADA')
    expect(coverageStatusForReference({ referenceType: 'PARTIDA', systemAvailableQuantity: 4, physicalQuantity: 0, inventoryStatus: 'CONCILIACION_FINAL' })).toBe('PARTIDA_SISTEMA_NO_CONTADA')
  })

  it('does not treat a matching quantity as a matching controlled identity', () => {
    expect(identityReconciliationStatus({ systemQuantity: 10, physicalQuantity: 10, identitiesMatch: false, c1Open: false, physicalConfirmed: false })).toBe('CUADRADO_CANTIDAD_CON_DIFERENCIA_REFERENCIAS')
    expect(identityReconciliationStatus({ systemQuantity: 10, physicalQuantity: 10, identitiesMatch: false, c1Open: false, physicalConfirmed: true })).toBe('FISICO_CONFIRMADO_CON_DIFERENCIA_IDENTIDAD')
  })

  it('keeps C1 absence provisional and blocks the monitor from CONTADOR', () => {
    expect(identityReconciliationStatus({ systemQuantity: 1, physicalQuantity: 0, identitiesMatch: false, c1Open: true, physicalConfirmed: false })).toBe('PENDIENTE_COBERTURA')
    expect(canAccessLiveMonitor('CONTADOR')).toBe(false)
    expect(canAccessLiveMonitor('ANALISTA')).toBe(true)
    expect(canAccessLiveMonitor('ADMIN')).toBe(true)
  })

  it('defines the complete operational event and mission vocabulary', () => {
    expect(liveMonitorEventTypeSchema.safeParse('C3_CONFIRMED_ZERO').success).toBe(true)
    expect(liveMonitorEventTypeSchema.safeParse('ERP_ADJUSTED_SILENTLY').success).toBe(false)
    expect(monitorMissionStatusSchema.options).toEqual(['NUEVO', 'EN_COLA', 'ASIGNADO', 'ACTIVO', 'COMPLETADO', 'CONFIRMADO_CERO'])
  })
})
