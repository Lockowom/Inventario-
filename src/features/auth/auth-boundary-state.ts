import type { AuthChangeEvent } from '@supabase/supabase-js'

export type RuntimeAuthState = 'CHECKING' | 'SIGNED_OUT' | 'SIGNED_IN'

/**
 * A null session is not equivalent to logout. Offline bootstrap / token refresh
 * may transiently expose no Supabase session while the durable authorization
 * context remains valid. Only SIGNED_OUT is authoritative for leaving runtime.
 */
export function nextRuntimeAuthState(
  current: RuntimeAuthState,
  event: AuthChangeEvent,
  hasSession: boolean,
): RuntimeAuthState {
  if (hasSession) return 'SIGNED_IN'
  if (event === 'SIGNED_OUT') return 'SIGNED_OUT'
  return current
}
