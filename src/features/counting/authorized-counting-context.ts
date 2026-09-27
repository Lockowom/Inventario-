import { z } from 'zod'
import type { ServerCountingContextResult } from '../../domain/count/resolve-counting-context'
import type { ActiveCountingContext } from '../../domain/count/save-physical-count'
import { profileSchema } from '../../domain/auth/contracts'
import { getSupabaseClient } from '../../services/supabase'
import { classifyAuthError, classifyPostgrestError } from './supabase-error-classification'
import { persistAuthUserId, readPersistedAuthUserId } from '../../services/local-auth-identity'

const inventoryRowSchema = z.object({ id: z.uuid(), status: z.enum(['BORRADOR', 'PREPARADO', 'ABIERTO', 'CERRADO', 'CONGELADO']) })

export function selectAuthorizedCountingContext(userId: string, rows: unknown[]): ActiveCountingContext | null {
  const open = rows.map((row) => inventoryRowSchema.safeParse(row)).flatMap((result) => result.success && result.data.status === 'ABIERTO' ? [result.data] : [])
  if (open.length !== 1) return null
  return { userId, inventoryId: open[0]!.id, inventoryStatus: 'ABIERTO' }
}

/** Network-authoritative verification. It never reads the local context cache. */
export async function verifyServerCountingContext(): Promise<ServerCountingContextResult> {
  const client = getSupabaseClient()
  if (!client) return { kind: 'UNAVAILABLE' }
  let authData: Awaited<ReturnType<typeof client.auth.getUser>>['data']
  try {
    const response = await client.auth.getUser()
    if (response.error) return classifyAuthError(response.error)
    authData = response.data
  } catch (error: unknown) {
    return classifyAuthError(error)
  }
  if (!authData.user) return { kind: 'NOT_AUTHORIZED' }
  const profileResponse = await client.from('profiles').select('user_id, display_name, role, active, created_at, updated_at').eq('user_id', authData.user.id).maybeSingle()
  if (profileResponse.error) return classifyPostgrestError(profileResponse)
  const profile = profileResponse.data
  const parsedProfile = profileSchema.safeParse(profile)
  if (!parsedProfile.success) return profile === null ? { kind: 'NOT_AUTHORIZED' } : { kind: 'AMBIGUOUS' }
  if (!parsedProfile.data.active || parsedProfile.data.user_id !== authData.user.id) return { kind: 'NOT_AUTHORIZED' }
  const assignmentsResponse = await client.from('inventory_assignments').select('inventory_id').eq('user_id', authData.user.id).eq('active', true)
  if (assignmentsResponse.error) return classifyPostgrestError(assignmentsResponse)
  const ids = (assignmentsResponse.data ?? []).map((assignment) => assignment.inventory_id)
  if (ids.length === 0) return { kind: 'NOT_AUTHORIZED' }
  const inventoriesResponse = await client.from('inventories').select('id, status').in('id', ids).eq('status', 'ABIERTO')
  if (inventoriesResponse.error) return classifyPostgrestError(inventoriesResponse)
  const parsed = (inventoriesResponse.data ?? []).map((row) => inventoryRowSchema.safeParse(row))
  if (parsed.some((result) => !result.success)) return { kind: 'AMBIGUOUS' }
  const open = parsed.flatMap((result) => result.success ? [result.data] : [])
  if (open.length === 0) return { kind: 'NOT_AUTHORIZED' }
  if (open.length !== 1) return { kind: 'AMBIGUOUS' }
  return { kind: 'AUTHORIZED', context: { userId: authData.user.id, inventoryId: open[0]!.id, inventoryStatus: 'ABIERTO' }, verifiedAt: new Date().toISOString() }
}

/** Reads only the Supabase client's persisted session identity for outage fallback. */
export async function getLocalSessionUserId(): Promise<string | null> {
  const client = getSupabaseClient()
  if (!client) return null
  try {
    const { data, error } = await client.auth.getSession()
    const userId = data.session?.user?.id ?? null
    if (userId) {
      persistAuthUserId(userId)
      return userId
    }
    if (error && classifyAuthError(error).kind === 'UNAVAILABLE') return readPersistedAuthUserId()
    return null
  } catch (error: unknown) {
    return classifyAuthError(error).kind === 'UNAVAILABLE' ? readPersistedAuthUserId() : null
  }
}
