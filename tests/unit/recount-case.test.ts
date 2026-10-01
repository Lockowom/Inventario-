import { describe, expect, it } from 'vitest'
import { assignSecondCount, assignThirdCount, blindSecondCountView, createRecountCase, recordSecondCount, recordThirdCount } from '../../src/domain/reconciliation/recount-case'

const first = { round: 1 as const, userId: 'contador-1', quantity: 31, capturedAt: '2026-10-01T00:00:00Z' }
const makeCase = () => createRecountCase({ id: 'case-1', inventoryId: 'inv-1', codigo: 'SKU-P', reference: '1304-501', firstCount: first })

describe('recount case', () => {
  it('asigna el segundo conteo a un usuario distinto', () => {
    expect(assignSecondCount(makeCase(), 'contador-2')).toMatchObject({ stage: '2DO_CONTEO_ASIGNADO', assignedSecondUserId: 'contador-2' })
    expect(() => assignSecondCount(makeCase(), 'contador-1')).toThrow('otro usuario')
  })

  it('entrega al segundo contador una vista ciega sin cantidad previa', () => {
    const assigned = assignSecondCount(makeCase(), 'contador-2')
    const view = blindSecondCountView(assigned, 'contador-2')
    expect(view).toEqual({ id: 'case-1', inventoryId: 'inv-1', codigo: 'SKU-P', reference: '1304-501', round: 2 })
    expect(view).not.toHaveProperty('firstCount')
    expect(view).not.toHaveProperty('quantity')
  })

  it('resuelve cuando el segundo conteo confirma el primero', () => {
    const assigned = assignSecondCount(makeCase(), 'contador-2')
    expect(recordSecondCount(assigned, { round: 2, userId: 'contador-2', quantity: 31, capturedAt: '2026-10-01T01:00:00Z' }))
      .toMatchObject({ stage: 'RESUELTO', resolutionQuantity: 31 })
  })

  it('escala a tercer conteo cuando primero y segundo discrepan', () => {
    const assigned = assignSecondCount(makeCase(), 'contador-2')
    expect(recordSecondCount(assigned, { round: 2, userId: 'contador-2', quantity: 29, capturedAt: '2026-10-01T01:00:00Z' }).stage)
      .toBe('REQUIERE_3ER_CONTEO')
  })

  it('reserva la asignación del tercer conteo exclusivamente a ANALISTA', () => {
    const second = recordSecondCount(assignSecondCount(makeCase(), 'contador-2'), { round: 2, userId: 'contador-2', quantity: 29, capturedAt: '2026-10-01T01:00:00Z' })
    expect(() => assignThirdCount(second, 'admin-1', 'ADMIN')).toThrow('reservado al ANALISTA')
    expect(assignThirdCount(second, 'analista-1', 'ANALISTA')).toMatchObject({ stage: '3ER_CONTEO_ASIGNADO', assignedThirdAnalystId: 'analista-1' })
  })

  it('el tercer conteo del ANALISTA determina la resolución sin sobrescribir conteos previos', () => {
    const second = recordSecondCount(assignSecondCount(makeCase(), 'contador-2'), { round: 2, userId: 'contador-2', quantity: 29, capturedAt: '2026-10-01T01:00:00Z' })
    const assigned = assignThirdCount(second, 'analista-1', 'ANALISTA')
    const resolved = recordThirdCount(assigned, { round: 3, userId: 'analista-1', quantity: 31, capturedAt: '2026-10-01T02:00:00Z' }, 'ANALISTA')
    expect(resolved).toMatchObject({ stage: 'RESUELTO', resolutionQuantity: 31 })
    expect(resolved.firstCount.quantity).toBe(31)
    expect(resolved.secondCount?.quantity).toBe(29)
    expect(resolved.thirdCount?.quantity).toBe(31)
  })

  it('rechaza a un usuario distinto del asignado', () => {
    const assigned = assignSecondCount(makeCase(), 'contador-2')
    expect(() => recordSecondCount(assigned, { round: 2, userId: 'contador-3', quantity: 31, capturedAt: '2026-10-01T01:00:00Z' })).toThrow('no asignado')
  })
})
