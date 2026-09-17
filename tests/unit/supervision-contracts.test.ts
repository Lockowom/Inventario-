import { describe, expect, it } from 'vitest'
import { activityState, localDateRangeToUtc, snapshotFilters } from '../../src/domain/supervision/contracts'

describe('supervision observation state', () => {
  const now = new Date('2026-09-17T12:00:00.000Z')

  it('does not manufacture presence when no device observation exists', () => {
    expect(activityState(null, now)).toBe('SIN DATOS')
  })

  it('labels only a recent server observation as recent activity', () => {
    expect(activityState('2026-09-17T11:50:00.000Z', now)).toBe('ACTIVO RECIENTEMENTE')
  })

  it('keeps stale observations distinct from an online assertion', () => {
    expect(activityState('2026-09-17T11:30:00.000Z', now)).toBe('SIN ACTIVIDAD RECIENTE')
  })
})

describe('supervision search contracts', () => {
  it('keeps applied filters immutable while the operator edits the draft before loading more', () => {
    const draft = { codigo: 'A', ubicacion: 'A-01-01' }
    const applied = snapshotFilters(draft)
    draft.codigo = 'B'
    expect(applied).toEqual({ codigo: 'A', ubicacion: 'A-01-01' })
  })

  it('uses local calendar boundaries rather than treating the HTML date as a UTC day', () => {
    const expectedStart = new Date(2026, 8, 17).toISOString()
    const expectedEnd = new Date(2026, 8, 18).toISOString()
    expect(localDateRangeToUtc({ capturedFrom: '2026-09-17', capturedTo: '2026-09-17' })).toEqual({ capturedFrom: expectedStart, capturedToExclusive: expectedEnd })
  })

  it('includes a 23:30 local capture inside that local calendar day', () => {
    const range = localDateRangeToUtc({ capturedFrom: '2026-09-17', capturedTo: '2026-09-17' })
    const capturedAt = new Date(2026, 8, 17, 23, 30).getTime()
    expect(capturedAt).toBeGreaterThanOrEqual(new Date(range.capturedFrom!).getTime())
    expect(capturedAt).toBeLessThan(new Date(range.capturedToExclusive!).getTime())
  })
})
