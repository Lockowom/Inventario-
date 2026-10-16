import { z } from 'zod'
import type { ServerCountingContextResult } from '../../domain/count/resolve-counting-context'
import type { ActiveCountingContext } from '../../domain/count/save-physical-count'
import { appRoleSchema } from '../../domain/auth/contracts'
import { getSupabaseClient } from '../../services/supabase'
import { classifyAuthError, classifyPostgrestError } from './supabase-error-classification'
import { persistAuthUserId, readPersistedAuthUserId } from '../../services/local-auth-identity'

const inventoryRowSchema = z.object({ id: z.uuid(), status: z.enum(['BORRADOR', 'PREPARADO', 'ABIERTO', 'CERRADO', 'CONGELADO']) })
const authorizationSnapshotResponseSchema = z.object({
  status: z.enum(['AUTHORIZED', 'NOT_AUTHORIZED', 'AMBIGUOUS']),
  schema_version: z.number().int(),
  actor_id: z.uuid().optional(),
  role: appRoleSchema.optional(),
  user_type: z.enum(['PERMANENT', 'CONTRACTOR_3PL', 'TEMPORARY', 'EXTERNAL_AUDITOR']).optional(),
  capabilities: z.array(z.string()).optional(),
  inventory_scopes: z.array(z.uuid()).optional(),
  warehouse_scopes: z.array(z.uuid()).optional(),
  inventory_id: z.uuid().optional(),
  warehouse_id: z.uuid().optional(),
  verified_at: z.string().datetime(),
})

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
  const snapshotResponse = await client.rpc('get_my_counting_authorization_snapshot')
  if (snapshotResponse.error) return classifyPostgrestError(snapshotResponse)
  const snapshot = authorizationSnapshotResponseSchema.safeParse(snapshotResponse.data)
  if (!snapshot.success) return { kind: 'AMBIGUOUS' }
  if (snapshot.data.status === 'NOT_AUTHORIZED') return { kind: 'NOT_AUTHORIZED' }
  if (snapshot.data.status === 'AMBIGUOUS') return { kind: 'AMBIGUOUS' }
  const data = snapshot.data
  if (data.schema_version !== 1 || data.actor_id !== authData.user.id || !data.user_type || !data.capabilities?.includes('COUNT_C1') || !data.inventory_id || !data.warehouse_id || !data.inventory_scopes?.includes(data.inventory_id) || !data.warehouse_scopes?.includes(data.warehouse_id)) return { kind: 'AMBIGUOUS' }
  return {
    kind: 'AUTHORIZED',
    context: { userId: authData.user.id, inventoryId: data.inventory_id, inventoryStatus: 'ABIERTO' },
    verifiedAt: data.verified_at,
    role: data.role,
    authorization: {
      actorId: data.actor_id,
      userType: data.user_type,
      capabilities: data.capabilities,
      inventoryScopes: data.inventory_scopes,
      warehouseScopes: data.warehouse_scopes,
      schemaVersion: 1,
    },
  }
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
    return readPersistedAuthUserId()
  } catch (error: unknown) {
    return classifyAuthError(error).kind === 'UNAVAILABLE' ? readPersistedAuthUserId() : null
  }
}
