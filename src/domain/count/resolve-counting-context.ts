import type { CachedCountingContext, CountingContextRepository } from '../ports/counting-context-repository'
import type { ActiveCountingContext } from './save-physical-count'

export type ServerCountingContextResult =
  | { kind: 'AUTHORIZED'; context: ActiveCountingContext; verifiedAt: string }
  | { kind: 'NOT_AUTHORIZED' }
  | { kind: 'AMBIGUOUS'; diagnostic?: CountingContextAmbiguity }
  | { kind: 'UNAVAILABLE' }

/**
 * A safe, user-actionable explanation for a fail-closed authority check.
 * This deliberately carries no raw database or authentication error details.
 */
export type CountingContextAmbiguity =
  | 'PROFILE_CONTRACT'
  | 'ASSIGNMENTS_QUERY'
  | 'INVENTORIES_QUERY'
  | 'INVENTORY_CONTRACT'
  | 'MULTIPLE_OPEN_INVENTORIES'

export interface CountingContextVerifier {
  verifyServer(): Promise<ServerCountingContextResult>
}

export type ResolvedCountingContext =
  | { kind: 'ONLINE'; context: ActiveCountingContext }
  | { kind: 'OFFLINE'; context: ActiveCountingContext }
  | { kind: 'BLOCKED'; reason: 'AMBIGUOUS'; diagnostic?: CountingContextAmbiguity }
  | { kind: 'BLOCKED'; reason: 'NOT_AUTHORIZED' | 'UNAVAILABLE' | 'CACHE_MISMATCH' }

/** Server answers win. During an outage, the durable server-verified cache is the offline authorization lease. */
export async function resolveCountingContext(verifier: CountingContextVerifier, cache: CountingContextRepository): Promise<ResolvedCountingContext> {
  const server = await verifier.verifyServer()
  if (server.kind === 'AUTHORIZED') {
    const cached: CachedCountingContext = { userId: server.context.userId, inventoryId: server.context.inventoryId, inventoryStatus: server.context.inventoryStatus, verifiedAt: server.verifiedAt }
    await cache.save(cached)
    return { kind: 'ONLINE', context: server.context }
  }
  if (server.kind === 'NOT_AUTHORIZED' || server.kind === 'AMBIGUOUS') {
    await cache.clear()
    return server.kind === 'AMBIGUOUS' && server.diagnostic
      ? { kind: 'BLOCKED', reason: server.kind, diagnostic: server.diagnostic }
      : { kind: 'BLOCKED', reason: server.kind }
  }
  const cached = await cache.get()
  if (!cached) return { kind: 'BLOCKED', reason: 'CACHE_MISMATCH' }
  return { kind: 'OFFLINE', context: { userId: cached.userId, inventoryId: cached.inventoryId, inventoryStatus: cached.inventoryStatus } }
}
