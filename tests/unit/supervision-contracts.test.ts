import { describe, expect, it } from 'vitest'
import { activityState } from '../../src/domain/supervision/contracts'

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
