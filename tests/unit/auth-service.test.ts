import { beforeEach, describe, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => ({
  signInWithPassword: vi.fn(),
  getSession: vi.fn(),
  signOut: vi.fn(),
  onAuthStateChange: vi.fn(() => ({ data: { subscription: { unsubscribe: vi.fn() } } })),
  getCachedContext: vi.fn(),
  clearCachedContext: vi.fn(),
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

vi.mock('../../src/features/counting/counting-runtime', () => ({
  getCountingContextRepository: () => ({
    get: mocks.getCachedContext,
    clear: mocks.clearCachedContext,
    save: vi.fn(),
  }),
}))

import { AuthService } from '../../src/features/auth/auth-service'
import { readPersistedAuthUserId } from '../../src/services/local-auth-identity'

const userId = '22222222-2222-4222-8222-222222222222'
const cachedContext = {
  userId,
  inventoryId: '11111111-1111-4111-8111-111111111111',
  inventoryStatus: 'ABIERTO' as const,
  verifiedAt: '2026-09-27T10:00:00.000Z',
}

describe('AuthService', () => {
  beforeEach(() => {
    localStorage.clear()
    mocks.signInWithPassword.mockReset()
    mocks.getSession.mockReset()
    mocks.signOut.mockReset()
    mocks.onAuthStateChange.mockClear()
    mocks.getCachedContext.mockReset()
    mocks.clearCachedContext.mockReset()
    mocks.getCachedContext.mockResolvedValue(null)
    mocks.clearCachedContext.mockResolvedValue(undefined)
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
  })

  it('prefiere una sesión Supabase válida cuando está disponible', async () => {
    mocks.getSession.mockResolvedValue({ data: { session: { user: { id: userId } } }, error: null })
    await expect(new AuthService().hasRuntimeIdentity()).resolves.toBe(true)
    expect(mocks.getCachedContext).not.toHaveBeenCalled()
  })

  it('arranca offline desde el contexto server-verified persistido aunque getSession sea null', async () => {
    mocks.getSession.mockResolvedValue({ data: { session: null }, error: null })
    mocks.getCachedContext.mockResolvedValue(cachedContext)

    await expect(new AuthService().hasRuntimeIdentity()).resolves.toBe(true)
    expect(mocks.getCachedContext).toHaveBeenCalledTimes(1)
  })

  it('arranca offline desde SQLite aunque getSession falle por red', async () => {
    mocks.getSession.mockRejectedValue(new TypeError('Failed to fetch'))
    mocks.getCachedContext.mockResolvedValue(cachedContext)

    await expect(new AuthService().hasRuntimeIdentity()).resolves.toBe(true)
  })

  it('bloquea el runtime si no hay sesión ni contexto autorizado persistido', async () => {
    mocks.getSession.mockResolvedValue({ data: { session: null }, error: null })
    mocks.getCachedContext.mockResolvedValue(null)

    await expect(new AuthService().hasRuntimeIdentity()).resolves.toBe(false)
  })
})
