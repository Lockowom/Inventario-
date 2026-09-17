import type { AuthChangeEvent, Session, User } from '@supabase/supabase-js'
import { profileSchema, type AppRole, type Profile } from '../../domain/auth/contracts'
import { getSupabaseClient } from '../../services/supabase'
import { getCountingContextRepository } from '../counting/counting-runtime'
import { signOutAndClearCountingContext } from '../../domain/count/sign-out-counting-context'

export interface AuthSubscription { unsubscribe(): void }
export type AuthSessionListener = (event: AuthChangeEvent, session: Session | null) => void

export class AuthService {
  private readonly localSignOutListeners = new Set<() => void>()
  public async getSession(): Promise<Session | null> {
    const client = getSupabaseClient()
    if (!client) return null
    const { data, error } = await client.auth.getSession()
    if (error) throw error
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
    return client.auth.onAuthStateChange(listener).data.subscription
  }

  /** Lets composition revoke in-memory capability when explicit logout starts. */
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
      for (const listener of this.localSignOutListeners) listener()
    }
  }
}

export const authService = new AuthService()
