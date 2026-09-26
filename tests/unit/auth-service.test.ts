import { beforeEach, describe, expect, it, vi } from 'vitest'

const signInWithPassword = vi.hoisted(() => vi.fn())
vi.mock('../../src/services/supabase', () => ({
  getSupabaseClient: () => ({ auth: { signInWithPassword } }),
}))

import { AuthService } from '../../src/features/auth/auth-service'

describe('AuthService.signIn', () => {
  beforeEach(() => signInWithPassword.mockReset())

  it('normaliza el correo y exige una sesión real', async () => {
    const session = { access_token: 'token' }
    signInWithPassword.mockResolvedValue({ data: { session }, error: null })
    await expect(new AuthService().signIn('  QA-ANALISTA@INVEN3-QA.TEST ', 'clave')).resolves.toBe(session)
    expect(signInWithPassword).toHaveBeenCalledWith({ email: 'qa-analista@inven3-qa.test', password: 'clave' })
  })

  it('falla de forma segura cuando Auth no entrega sesión', async () => {
    signInWithPassword.mockResolvedValue({ data: { session: null }, error: { message: 'bad credentials' } })
    await expect(new AuthService().signIn('qa@inven3.test', 'mala')).rejects.toThrow('Credenciales inválidas o sesión no disponible.')
  })
})
