import type { AuthorizationSnapshot, CachedCountingContext, CountingContextRepository } from '../ports/counting-context-repository'
import type { ActiveCountingContext } from './save-physical-count'
import type { AppRole } from '../auth/contracts'

export type ServerCountingContextResult =
  | { kind: 'AUTHORIZED'; context: ActiveCountingContext; verifiedAt: string; authorization: AuthorizationSnapshot; role?: AppRole }
  | { kind: 'NOT_AUTHORIZED' }
  | { kind: 'INVENTORY_SELECTION_REQUIRED' }
  | { kind: 'AMBIGUOUS' }
  | { kind: 'UNAVAILABLE' }

export interface CountingContextVerifier {
  verifyServer(activeInventoryId?: string): Promise<ServerCountingContextResult>
}

export type ResolvedCountingContext =
  | { kind: 'ONLINE'; context: ActiveCountingContext }
  | { kind: 'OFFLINE'; context: ActiveCountingContext }
  | { kind: 'SELECTION_REQUIRED' }
  | { kind: 'BLOCKED'; reason: Exclude<ServerCountingContextResult['kind'], 'AUTHORIZED' | 'INVENTORY_SELECTION_REQUIRED'> | 'CACHE_MISMATCH' }

/** Server answers win. During an outage, the durable server-verified cache is the offline authorization lease. */
export async function resolveCountingContext(verifier: CountingContextVerifier, cache: CountingContextRepository, activeInventoryId?: string): Promise<ResolvedCountingContext> {
  const cached = await cache.get()
  // Online selection is session state validated by the backend. The cache is
  // deliberately consulted only after the backend is unavailable.
  const server = await verifier.verifyServer(activeInventoryId)
  if (server.kind === 'AUTHORIZED') {
    const cached: CachedCountingContext = { userId: server.context.userId, inventoryId: server.context.inventoryId, inventoryStatus: 'ABIERTO', verifiedAt: server.verifiedAt, authorization: server.authorization, role: server.role }
    await cache.save(cached)
    return { kind: 'ONLINE', context: server.context }
  }
  if (server.kind === 'INVENTORY_SELECTION_REQUIRED') return { kind: 'SELECTION_REQUIRED' }
  if (server.kind === 'NOT_AUTHORIZED' || server.kind === 'AMBIGUOUS') {
    await cache.clear()
    return { kind: 'BLOCKED', reason: server.kind }
  }
  if (!cached) return { kind: 'BLOCKED', reason: 'CACHE_MISMATCH' }
  // The cache is only an offline lease for the same actor and inventory. It
  // must include the exact C1 capability and both scopes; a legacy role-only
  // row is rejected by the repository rather than inferred as authorized.
  if ((activeInventoryId && activeInventoryId !== cached.inventoryId)
    || cached.authorization.actorId !== cached.userId
    || !cached.authorization.capabilities.includes('COUNT_C1')
    || !cached.authorization.inventoryScopes.includes(cached.inventoryId)) return { kind: 'BLOCKED', reason: 'CACHE_MISMATCH' }
  return { kind: 'OFFLINE', context: { userId: cached.userId, inventoryId: cached.inventoryId, inventoryStatus: 'ABIERTO' } }
}
