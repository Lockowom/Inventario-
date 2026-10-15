import { describe, expect, it } from 'vitest'
import { createManagedUserSchema, managedUserSchema, setTemporaryPasswordSchema, updateManagedUserSchema } from '../../src/domain/user-management/contracts'

const id = '11111111-1111-4111-8111-111111111111'

describe('user-management contracts', () => {
  it('accepts a safe managed-user view without a password field', () => {
    const user = managedUserSchema.parse({ user_id: id, email: 'counter@example.com', display_name: 'Counter', role: 'CONTADOR', active: true, created_at: '2026-10-02T00:00:00Z', updated_at: '2026-10-02T00:00:00Z', inventoryIds: [] })
    expect(user).not.toHaveProperty('password')
  })
  it('requires an administrator-selected password only for create or password reset', () => {
    expect(() => createManagedUserSchema.parse({ email: 'new@example.com', displayName: 'New', role: 'CONTADOR', password: 'short' })).toThrow()
    expect(setTemporaryPasswordSchema.parse({ userId: id, password: 'Temporary-password-12' }).password).toBe('Temporary-password-12')
    expect(updateManagedUserSchema.parse({ userId: id, displayName: 'New', role: 'ANALISTA', active: true, inventoryIds: [] })).not.toHaveProperty('password')
  })
})
