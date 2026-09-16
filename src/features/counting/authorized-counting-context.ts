import { z } from 'zod'
import type { ServerCountingContextResult } from '../../domain/count/resolve-counting-context'
import type { ActiveCountingContext } from '../../domain/count/save-physical-count'
import { profileSchema } from '../../domain/auth/contracts'
import { getSupabaseClient } from '../../services/supabase'

const inventoryRowSchema = z.object({ id: z.uuid(), status: z.enum(['BORRADOR', 'PREPARADO', 'ABIERTO', 'CERRADO', 'CONGELADO']) })

export function selectAuthorizedCountingContext(userId: string, rows: unknown[]): ActiveCountingContext | null {
  const open = rows.map((row) => inventoryRowSchema.safeParse(row)).flatMap((result) => result.success && result.data.status === 'ABIERTO' ? [result.data] : [])
  if (open.length !== 1) return null
  return { userId, inventoryId: open[0]!.id, inventoryStatus: 'ABIERTO' }
}

function outcomeForError(error: unknown): Exclude<ServerCountingContextResult, { kind: 'AUTHORIZED' }> {
  const status = typeof error === 'object' && error !== null && typeof (error as { status?: unknown }).status === 'number' ? (error as { status: number }).status : undefined
  if (status === 401 || status === 403) return { kind: 'NOT_AUTHORIZED' }
  return status !== undefined && status >= 400 && status < 500 ? { kind: 'AMBIGUOUS' } : { kind: 'UNAVAILABLE' }
}

/** Network-authoritative verification. It never reads the local context cache. */
export async function verifyServerCountingContext(): Promise<ServerCountingContextResult> {
  const client = getSupabaseClient()
  if (!client) return { kind: 'UNAVAILABLE' }
  const { data: authData, error: authError } = await client.auth.getUser()
  if (authError) return outcomeForError(authError)
  if (!authData.user) return { kind: 'NOT_AUTHORIZED' }
  const { data: profile, error: profileError } = await client.from('profiles').select('user_id, display_name, role, active, created_at, updated_at').eq('user_id', authData.user.id).maybeSingle()
  if (profileError) return outcomeForError(profileError)
  const parsedProfile = profileSchema.safeParse(profile)
  if (!parsedProfile.success) return profile === null ? { kind: 'NOT_AUTHORIZED' } : { kind: 'AMBIGUOUS' }
  if (!parsedProfile.data.active || parsedProfile.data.user_id !== authData.user.id) return { kind: 'NOT_AUTHORIZED' }
  const { data: assignments, error: assignmentsError } = await client.from('inventory_assignments').select('inventory_id').eq('user_id', authData.user.id).eq('active', true)
  if (assignmentsError) return outcomeForError(assignmentsError)
  const ids = (assignments ?? []).map((assignment) => assignment.inventory_id)
  if (ids.length === 0) return { kind: 'NOT_AUTHORIZED' }
  const { data: inventories, error: inventoriesError } = await client.from('inventories').select('id, status').in('id', ids).eq('status', 'ABIERTO')
  if (inventoriesError) return outcomeForError(inventoriesError)
  const parsed = (inventories ?? []).map((row) => inventoryRowSchema.safeParse(row))
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
    if (error) return null
    return data.session?.user.id ?? null
  } catch { return null }
}
