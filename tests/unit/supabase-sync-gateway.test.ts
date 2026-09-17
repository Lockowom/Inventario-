import { describe, expect, it } from 'vitest'
import { classifySupabaseSyncError } from '../../src/services/supabase-sync-gateway'

describe('SupabaseSyncGateway error classification', () => {
  it('maps authorization and contract failures to terminal safe diagnostics', () => {
    expect(classifySupabaseSyncError({ code: '42501' })).toMatchObject({ kind: 'TERMINAL_AUTHORIZATION', code: 'SYNC_AUTHORIZATION_BLOCKED', retryable: false })
    expect(classifySupabaseSyncError({ code: '42P01' })).toMatchObject({ kind: 'TERMINAL_CONTRACT', code: 'SYNC_CONTRACT_ERROR', retryable: false })
    expect(classifySupabaseSyncError({ code: 'PGRST204' })).toMatchObject({ kind: 'TERMINAL_CONTRACT', retryable: false })
  })

  it('maps 503, network failure and explicit timeout to retryable transient failures', () => {
    expect(classifySupabaseSyncError({ message: 'Service unavailable' }, 503)).toMatchObject({ kind: 'TRANSIENT', retryable: true })
    expect(classifySupabaseSyncError(new TypeError('Failed to fetch'))).toMatchObject({ kind: 'TRANSIENT', retryable: true })
    expect(classifySupabaseSyncError({ message: 'request timeout' })).toMatchObject({ kind: 'TRANSIENT', retryable: true })
  })
})
