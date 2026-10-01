import { describe, expect, it } from 'vitest'
import { createReconciliationCase, markPhysicalConfirmed, requiresSystemAdjustment, resolveReconciliation } from '../../src/domain/reconciliation/reconciliation-case'

const anomaly = { type: 'DIFERENCIA_CANTIDAD_PARTIDA' as const, codigo: 'SKU-P', reference: 'L1', systemQuantity: 30, physicalQuantity: 31, difference: 1 }

describe('reconciliation case', () => {
  it('confirmar el físico no equivale a ajustar sistema', () => {
    const item = markPhysicalConfirmed(createReconciliationCase('r1', anomaly), 31)
    expect(item.status).toBe('FISICO_CONFIRMADO')
    expect(item.decision).toBeNull()
    expect(requiresSystemAdjustment(item)).toBe(false)
  })

  it('solo ANALISTA puede emitir el dictamen final', () => {
    const item = markPhysicalConfirmed(createReconciliationCase('r1', anomaly), 31)
    const decision = { disposition: 'AJUSTE_PROPUESTO' as const, reason: 'Dos conteos físicos confirman 31.', analystUserId: 'a1', decidedAt: '2026-10-01T02:00:00Z' }
    expect(() => resolveReconciliation(item, decision, 'ADMIN')).toThrow('reservado al ANALISTA')
    expect(resolveReconciliation(item, decision, 'ANALISTA')).toMatchObject({ status: 'RESUELTO', decision: { disposition: 'AJUSTE_PROPUESTO' } })
  })

  it('no permite cerrar sin justificación documental', () => {
    const item = createReconciliationCase('r1', anomaly)
    expect(() => resolveReconciliation(item, { disposition: 'SIN_AJUSTE', reason: ' ', analystUserId: 'a1', decidedAt: '2026-10-01T02:00:00Z' }, 'ANALISTA')).toThrow('justificación')
  })
})
