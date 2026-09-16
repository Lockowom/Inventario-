import { describe, expect, it } from 'vitest'
import { locationSchema } from '../../src/domain/validation/location'
import { countRecordSchema } from '../../src/domain/count/contracts'
import { profileSchema } from '../../src/domain/auth/contracts'
import { authService } from '../../src/features/auth/auth-service'

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

  it('acepta únicamente roles aprobados en un perfil', () => {
    expect(profileSchema.safeParse({ user_id: crypto.randomUUID(), display_name: 'Ana', role: 'SUPERVISOR', active: true, created_at: '2026-01-01T00:00:00Z', updated_at: '2026-01-01T00:00:00Z' }).success).toBe(false)
  })

  it('trata ausencia de configuración como sesión no disponible', async () => {
    await expect(authService.getUser()).resolves.toBeNull()
  })
})
