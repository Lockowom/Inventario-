export type SyncTransportErrorKind = 'TRANSIENT' | 'TERMINAL_AUTHORIZATION' | 'TERMINAL_CONTRACT' | 'UNKNOWN_FAIL_CLOSED'

/**
 * Stable, safe error vocabulary from a transport adapter to the sync domain.
 * Raw PostgREST/Supabase errors must never leak past the adapter boundary.
 */
export class SyncTransportError extends Error {
  public readonly retryable: boolean

  public constructor(public readonly kind: SyncTransportErrorKind, public readonly code: string) {
    super(code)
    this.name = 'SyncTransportError'
    this.retryable = kind === 'TRANSIENT'
  }
}

export function asFailClosedSyncError(error: unknown): SyncTransportError {
  return error instanceof SyncTransportError ? error : new SyncTransportError('UNKNOWN_FAIL_CLOSED', 'SYNC_UNKNOWN_ERROR')
}
