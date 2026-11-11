import { z } from 'zod'
import { postgresUuidSchema } from '../../domain/postgres-id'
import type { ServerCountingContextResult } from '../../domain/count/resolve-counting-context'
import type { ActiveCountingContext } from '../../domain/count/save-physical-count'
import { appRoleSchema } from '../../domain/auth/contracts'
import { getSupabaseClient } from '../../services/supabase'
import { classifyAuthError, classifyPostgrestError } from './supabase-error-classification'
import { persistAuthUserId, readPersistedAuthUserId } from '../../services/local-auth-identity'

// PostgreSQL's uuid type accepts a syntactically valid GUID even when a QA
// fixture does not use an RFC version/variant nibble.  Keep the format guard
// while accepting every identifier the authoritative database can return.
const inventoryRowSchema = z.object({ id: postgresUuidSchema, status: z.enum(['BORRADOR', 'PREPARADO', 'ABIERTO', 'CERRADO', 'CONGELADO']) })
const authorizationSnapshotResponseSchema = z.object({
  status: z.enum(['AUTHORIZED', 'NOT_AUTHORIZED', 'INVENTORY_SELECTION_REQUIRED', 'AMBIGUOUS']),
  schema_version: z.number().int(),
  actor_id: postgresUuidSchema.optional(),
  role: appRoleSchema.optional(),
  user_type: z.enum(['PERMANENT', 'CONTRACTOR_3PL', 'TEMPORARY', 'EXTERNAL_AUDITOR']).optional(),
  capabilities: z.array(z.string()).optional(),
  inventory_scopes: z.array(postgresUuidSchema).optional(),
  warehouse_scopes: z.array(postgresUuidSchema).optional(),
  inventory_id: postgresUuidSchema.optional(),
  warehouse_id: postgresUuidSchema.optional(),
  // PostgreSQL `now()` is serialized by PostgREST with an explicit UTC
  // offset (`+00:00`), not necessarily a trailing `Z`.
  verified_at: z.string().datetime({ offset: true }),
})

export function selectAuthorizedCountingContext(userId: string, rows: unknown[], activeInventoryId?: string): ActiveCountingContext | null {
  const open = rows.map((row) => inventoryRowSchema.safeParse(row)).flatMap((result) => result.success && result.data.status === 'ABIERTO' ? [result.data] : [])
  const selected = activeInventoryId ? open.find((inventory) => inventory.id === activeInventoryId) : open.length === 1 ? open[0] : undefined
  return selected ? { userId, inventoryId: selected.id, inventoryStatus: 'ABIERTO' } : null
}

function isQaDebugBuild(): boolean {
  return import.meta.env.VITE_RELEASE_ENV?.trim().toLowerCase() === 'qa'
}

function safeCode(value: unknown): string {
  return typeof value === 'string' && /^[A-Za-z0-9_.-]{1,80}$/.test(value) ? value : '-'
}

/**
 * QA-only, scalar diagnostics for the C1 authorization handshake. This never
 * writes an actor, inventory, token, email, scope value or server message.
 */
function logC1Context(stage: string, values: Record<string, string | number | boolean | null> = {}) {
  if (!isQaDebugBuild()) return
  const fields = Object.entries(values).map(([key, value]) => `${key}=${value ?? '-'}`).join(' ')
  console.info(`INVEN3_C1_CONTEXT stage=${stage}${fields ? ` ${fields}` : ''}`)
}

/** Network-authoritative verification. It never reads the local context cache. */
export async function verifyServerCountingContext(activeInventoryId?: string): Promise<ServerCountingContextResult> {
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
  const snapshotResponse = await client.rpc('get_my_counting_authorization_snapshot', { p_inventory_id: activeInventoryId ?? null })
  if (snapshotResponse.error) {
    logC1Context('rpc_error', { code: safeCode(snapshotResponse.error.code), status: snapshotResponse.status ?? null })
    return classifyPostgrestError(snapshotResponse)
  }
  const snapshot = authorizationSnapshotResponseSchema.safeParse(snapshotResponse.data)
  if (!snapshot.success) {
    logC1Context('payload_invalid')
    return { kind: 'AMBIGUOUS' }
  }
  if (snapshot.data.status === 'NOT_AUTHORIZED') {
    logC1Context('not_authorized', { snapshot_status: snapshot.data.status })
    return { kind: 'NOT_AUTHORIZED' }
  }
  if (snapshot.data.status === 'INVENTORY_SELECTION_REQUIRED') {
    console.info('INVEN3_CONTEXT INVENTORY_SELECTION_REQUIRED')
    return { kind: 'INVENTORY_SELECTION_REQUIRED' }
  }
  if (snapshot.data.status === 'AMBIGUOUS') {
    logC1Context('ambiguous', { snapshot_status: snapshot.data.status })
    return { kind: 'AMBIGUOUS' }
  }
  const data = snapshot.data
  const userType = data.user_type
  const capabilities = data.capabilities
  const inventoryScopes = data.inventory_scopes
  const warehouseScopes = data.warehouse_scopes
  const actorMatches = data.actor_id === authData.user.id
  const hasC1 = capabilities?.includes('COUNT_C1') === true
  const inventoryInScope = Boolean(data.inventory_id && inventoryScopes?.includes(data.inventory_id))
  const warehouseInScope = Boolean(data.warehouse_id && warehouseScopes?.includes(data.warehouse_id))
  if (data.schema_version !== 1 || !data.actor_id || !actorMatches || !userType || !capabilities || !inventoryScopes || !warehouseScopes || !hasC1 || !data.inventory_id || !data.warehouse_id || !inventoryInScope || !warehouseInScope) {
    logC1Context('contract_rejected', { schema_version: data.schema_version, actor_matches: actorMatches, has_count_c1: hasC1, inventory_in_scope: inventoryInScope, warehouse_in_scope: warehouseInScope, has_user_type: Boolean(userType), has_inventory: Boolean(data.inventory_id), has_warehouse: Boolean(data.warehouse_id) })
    return { kind: 'AMBIGUOUS' }
  }
  logC1Context('authorized', { schema_version: data.schema_version, has_count_c1: hasC1, inventory_in_scope: inventoryInScope, warehouse_in_scope: warehouseInScope })
  return {
    kind: 'AUTHORIZED',
    context: { userId: authData.user.id, inventoryId: data.inventory_id, inventoryStatus: 'ABIERTO' },
    verifiedAt: data.verified_at,
    role: data.role,
    authorization: {
      actorId: data.actor_id,
      userType,
      capabilities,
      inventoryScopes,
      warehouseScopes,
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
