import { beforeEach, describe, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => ({
  signInWithPassword: vi.fn(),
  getSession: vi.fn(),
  signOut: vi.fn(),
  onAuthStateChange: vi.fn(() => ({ data: { subscription: { unsubscribe: vi.fn() } } })),
}))

vi.mock('../../src/services/supabase', () => ({
  getSupabaseClient: () => ({
    auth: {
      signInWithPassword: mocks.signInWithPassword,
      getSession: mocks.getSession,
      signOut: mocks.signOut,
      onAuthStateChange: mocks.onAuthStateChange,
    },
  }),
}))

import { AuthService } from '../../src/features/auth/auth-service'
import { persistAuthUserId, readPersistedAuthUserId } from '../../src/services/local-auth-identity'

const userId = '22222222-2222-4222-8222-222222222222'

describe('AuthService', () => {
  beforeEach(() => {
    localStorage.clear()
    mocks.signInWithPassword.mockReset()
    mocks.getSession.mockReset()
    mocks.signOut.mockReset()
    mocks.onAuthStateChange.mockClear()
  })

  it('normaliza el correo, exige una sesión real y persiste sólo el UUID local', async () => {
    const session = { access_token: 'token', user: { id: userId } }
    mocks.signInWithPassword.mockResolvedValue({ data: { session, user: session.user }, error: null })

    await expect(new AuthService().signIn('  QA-ANALISTA@INVEN3-QA.TEST ', 'clave')).resolves.toBe(session)

    expect(mocks.signInWithPassword).toHaveBeenCalledWith({ email: 'qa-analista@inven3-qa.test', password: 'clave' })
    expect(readPersistedAuthUserId()).toBe(userId)
  })

  it('falla de forma segura cuando Auth no entrega sesión', async () => {
    mocks.signInWithPassword.mockResolvedValue({ data: { session: null, user: null }, error: { message: 'bad credentials' } })
    await expect(new AuthService().signIn('qa@inven3.test', 'mala')).rejects.toThrow('Credenciales inválidas o sesión no disponible.')
    expect(readPersistedAuthUserId()).toBeNull()
  })

  it('mantiene runtime autenticado offline cuando el refresh falla de forma retryable', async () => {
    persistAuthUserId(userId)
    mocks.getSession.mockResolvedValue({
      data: { session: null },
      error: { name: 'AuthRetryableFetchError', status: 0, message: 'Failed to fetch' },
    })

    await expect(new AuthService().hasRuntimeIdentity()).resolves.toBe(true)
    expect(readPersistedAuthUserId()).toBe(userId)
  })

  it('no reutiliza identidad persistida cuando Auth confirma que no existe sesión', async () => {
    persistAuthUserId(userId)
    mocks.getSession.mockResolvedValue({ data: { session: null }, error: null })

    await expect(new AuthService().hasRuntimeIdentity()).resolves.toBe(false)
    expect(readPersistedAuthUserId()).toBeNull()
  })
})
