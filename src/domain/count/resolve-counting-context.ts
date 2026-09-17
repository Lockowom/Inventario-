import type { CachedCountingContext, CountingContextRepository } from '../ports/counting-context-repository'
import type { ActiveCountingContext } from './save-physical-count'

export type ServerCountingContextResult =
  | { kind: 'AUTHORIZED'; context: ActiveCountingContext; verifiedAt: string }
  | { kind: 'NOT_AUTHORIZED' }
  | { kind: 'AMBIGUOUS' }
  | { kind: 'UNAVAILABLE' }

export interface CountingContextVerifier {
  verifyServer(): Promise<ServerCountingContextResult>
  getLocalSessionUserId(): Promise<string | null>
}

export type ResolvedCountingContext =
  | { kind: 'ONLINE'; context: ActiveCountingContext }
  | { kind: 'OFFLINE'; context: ActiveCountingContext }
  | { kind: 'BLOCKED'; reason: Exclude<ServerCountingContextResult['kind'], 'AUTHORIZED'> | 'CACHE_MISMATCH' }

/** Server answers win. Cache is only a last-known authorization for a same-user outage. */
export async function resolveCountingContext(verifier: CountingContextVerifier, cache: CountingContextRepository): Promise<ResolvedCountingContext> {
  const server = await verifier.verifyServer()
  if (server.kind === 'AUTHORIZED') {
    const cached: CachedCountingContext = { userId: server.context.userId, inventoryId: server.context.inventoryId, inventoryStatus: 'ABIERTO', verifiedAt: server.verifiedAt }
    await cache.save(cached)
    return { kind: 'ONLINE', context: server.context }
  }
  if (server.kind === 'NOT_AUTHORIZED' || server.kind === 'AMBIGUOUS') {
    await cache.clear()
    return { kind: 'BLOCKED', reason: server.kind }
  }
  const [cached, localUserId] = await Promise.all([cache.get(), verifier.getLocalSessionUserId()])
  if (!cached || !localUserId || cached.userId !== localUserId) return { kind: 'BLOCKED', reason: 'CACHE_MISMATCH' }
  return { kind: 'OFFLINE', context: { userId: cached.userId, inventoryId: cached.inventoryId, inventoryStatus: 'ABIERTO' } }
}
