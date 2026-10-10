const STORAGE_KEY = 'inven3:persisted-auth-user-id'
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i

function storage(): Storage | null {
  try {
    return typeof globalThis.localStorage === 'object' ? globalThis.localStorage : null
  } catch {
    return null
  }
}

/**
 * Stores only the authenticated user UUID. It is not an authorization token.
 * Server authorization and the cached counting context remain separate gates.
 */
export function persistAuthUserId(userId: string): void {
  if (!UUID.test(userId)) return
  try { storage()?.setItem(STORAGE_KEY, userId.toLowerCase()) } catch { /* storage unavailable */ }
}

export function readPersistedAuthUserId(): string | null {
  try {
    const value = storage()?.getItem(STORAGE_KEY) ?? null
    return value && UUID.test(value) ? value.toLowerCase() : null
  } catch {
    return null
  }
}

export function clearPersistedAuthUserId(): void {
  try { storage()?.removeItem(STORAGE_KEY) } catch { /* storage unavailable */ }
}
