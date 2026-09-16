import { describe, expect, it } from 'vitest'
import { locationSchema } from '../../src/domain/validation/location'
import { countRecordSchema } from '../../src/domain/count/contracts'

describe('contratos compartidos', () => {
  it('acepta una ubicación contractual', () => {
    expect(locationSchema.parse('C2-15-03')).toBe('C2-15-03')
  })

  it('rechaza un pasillo no autorizado', () => {
    expect(() => locationSchema.parse('E-15-03')).toThrow('Ubicación mal digitada')
  })

  it('requiere un UUID idempotente para el conteo', () => {
    expect(countRecordSchema.safeParse({ clientCountId: 'not-a-uuid' }).success).toBe(false)
  })
})
