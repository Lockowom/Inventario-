import type { CountingContextRepository } from '../ports/counting-context-repository'

/** Explicit logout must invalidate offline authority even when remote sign-out errors. */
export async function signOutAndClearCountingContext(signOut: () => Promise<void>, cache: CountingContextRepository): Promise<void> {
  try { await signOut() } finally { await cache.clear() }
}
