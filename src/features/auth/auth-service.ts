import type { AuthChangeEvent, Session, User } from '@supabase/supabase-js'
import { profileSchema, type AppRole, type Profile } from '../../domain/auth/contracts'
import { getSupabaseClient } from '../../services/supabase'
import { getCountingContextRepository } from '../counting/counting-runtime'
import { signOutAndClearCountingContext } from '../../domain/count/sign-out-counting-context'
import { clearPersistedAuthUserId, persistAuthUserId, readPersistedAuthUserId } from '../../services/local-auth-identity'
import { classifyAuthError } from '../counting/supabase-error-classification'

export interface AuthSubscription { unsubscribe(): void }
export type AuthSessionListener = (event: AuthChangeEvent, session: Session | null) => void

export class AuthService {
  private readonly localSignOutListeners = new Set<() => void>()

  public async getSession(): Promise<Session | null> {
    const client = getSupabaseClient()
    if (!client) return null
    const { data, error } = await client.auth.getSession()
    if (error) throw error
    if (data.session?.user?.id) persistAuthUserId(data.session.user.id)
    if (!data.session) clearPersistedAuthUserId()
    return data.session
  }

  public async hasRuntimeIdentity(): Promise<boolean> {
    const client = getSupabaseClient()
    if (!client) return false
    try {
      const { data, error } = await client.auth.getSession()
      if (data.session?.user?.id) {
        persistAuthUserId(data.session.user.id)
        return true
      }
      if (error && classifyAuthError(error).kind === 'UNAVAILABLE') return readPersistedAuthUserId() !== null
      if (!error) clearPersistedAuthUserId()
      return false
    } catch (error: unknown) {
      return classifyAuthError(error).kind === 'UNAVAILABLE' && readPersistedAuthUserId() !== null
    }
  }

  public async signIn(email: string, password: string): Promise<Session> {
    const client = getSupabaseClient()
    if (!client) throw new Error('Supabase no configurado.')
    const normalizedEmail = email.trim().toLowerCase()
    if (!normalizedEmail || !password) throw new Error('Correo y contraseña son obligatorios.')
    const { data, error } = await client.auth.signInWithPassword({ email: normalizedEmail, password })
    if (error || !data.session) throw new Error('Credenciales inválidas o sesión no disponible.')
    const userId = data.session.user?.id ?? data.user?.id
    if (userId) persistAuthUserId(userId)
    return data.session
  }

  public async getUser(): Promise<User | null> {
    const client = getSupabaseClient()
    if (!client) return null
    const { data, error } = await client.auth.getUser()
    if (error) throw error
    return data.user
  }

  public async getProfile(): Promise<Profile | null> {
    const client = getSupabaseClient()
    const user = await this.getUser()
    if (!client || !user) return null
    const { data, error } = await client.from('profiles').select('user_id, display_name, role, active, created_at, updated_at').eq('user_id', user.id).maybeSingle()
    if (error) throw error
    return data ? profileSchema.parse(data) : null
  }

  public async getRole(): Promise<AppRole | null> {
    const profile = await this.getProfile()
    return profile?.active ? profile.role : null
  }

  public onAuthStateChange(listener: AuthSessionListener): AuthSubscription {
    const client = getSupabaseClient()
    if (!client) return { unsubscribe: () => undefined }
    return client.auth.onAuthStateChange((event, session) => {
      if (session?.user?.id) persistAuthUserId(session.user.id)
      else if (event === 'SIGNED_OUT' || event === 'USER_DELETED') clearPersistedAuthUserId()
      listener(event, session)
    }).data.subscription
  }

  public onLocalSignOut(listener: () => void): AuthSubscription {
    this.localSignOutListeners.add(listener)
    return { unsubscribe: () => this.localSignOutListeners.delete(listener) }
  }

  public async signOut(): Promise<void> {
    const client = getSupabaseClient()
    try {
      await signOutAndClearCountingContext(async () => {
        if (!client) return
        const { error } = await client.auth.signOut()
        if (error) throw error
      }, getCountingContextRepository())
    } finally {
      clearPersistedAuthUserId()
      for (const listener of this.localSignOutListeners) listener()
    }
  }
}

export const authService = new AuthService()
