import { describe, expect, it, vi } from 'vitest'

const rpc = vi.hoisted(() => vi.fn())
vi.mock('../../src/services/supabase', () => ({ getSupabaseClient: () => ({ rpc }) }))

import { classifySupabaseSyncError, SupabaseSyncGateway } from '../../src/services/supabase-sync-gateway'

const inventoryId = '11111111-1111-4111-8111-111111111111'
const deviceId = '22222222-2222-4222-8222-222222222222'

describe('SupabaseSyncGateway error classification', () => {
  it('keeps authentication failures terminal before other classifications', () => {
    expect(classifySupabaseSyncError({ code: '42501' })).toMatchObject({ kind: 'TERMINAL_AUTHORIZATION', code: 'SYNC_AUTHORIZATION_BLOCKED', retryable: false })
    for (const code of ['PGRST301', 'PGRST302', 'PGRST303']) expect(classifySupabaseSyncError({ code })).toMatchObject({ kind: 'TERMINAL_AUTHORIZATION', retryable: false })
  })

  it('keeps connection PGRST codes retryable before contract code groups', () => {
    for (const code of ['PGRST000', 'PGRST001', 'PGRST002', 'PGRST003']) expect(classifySupabaseSyncError({ code })).toMatchObject({ kind: 'TRANSIENT', retryable: true })
    expect(classifySupabaseSyncError(new TypeError('Failed to fetch'))).toMatchObject({ kind: 'TRANSIENT', retryable: true })
    expect(classifySupabaseSyncError({ message: 'request timeout' })).toMatchObject({ kind: 'TRANSIENT', retryable: true })
  })

  it('classifies schema/request errors as terminal contract failures', () => {
    expect(classifySupabaseSyncError({ code: '42P01' }, 404)).toMatchObject({ kind: 'TERMINAL_CONTRACT', retryable: false })
    expect(classifySupabaseSyncError({ code: '42703' })).toMatchObject({ kind: 'TERMINAL_CONTRACT', retryable: false })
    expect(classifySupabaseSyncError({ code: 'PGRST204' }, 400)).toMatchObject({ kind: 'TERMINAL_CONTRACT', retryable: false })
  })

  it('uses the real RPC response status for PGRST001 / HTTP 503', async () => {
    rpc.mockResolvedValueOnce({ data: null, error: { code: 'PGRST001', message: 'database unavailable' }, status: 503, statusText: 'Service Unavailable' })
    await expect(new SupabaseSyncGateway().registerDevice({ deviceId })).rejects.toMatchObject({ kind: 'TRANSIENT', retryable: true })
  })

  it('uses the real RPC response status for 42501 / HTTP 403', async () => {
    rpc.mockResolvedValueOnce({ data: null, error: { code: '42501', message: 'forbidden' }, status: 403, statusText: 'Forbidden' })
    await expect(new SupabaseSyncGateway().reportPending({ inventoryId, deviceId, pendingCount: 1 })).rejects.toMatchObject({ kind: 'TERMINAL_AUTHORIZATION', retryable: false })
  })

  it('uses the real RPC response status for PGRST003 / HTTP 504', async () => {
    rpc.mockResolvedValueOnce({ data: null, error: { code: 'PGRST003', message: 'pool exhausted' }, status: 504, statusText: 'Gateway Timeout' })
    await expect(new SupabaseSyncGateway().syncBatch({ inventoryId, deviceId, records: [] })).rejects.toMatchObject({ kind: 'TRANSIENT', retryable: true })
  })

  it('uses the real RPC response status for a contractual 42P01 / HTTP 404', async () => {
    rpc.mockResolvedValueOnce({ data: null, error: { code: '42P01', message: 'table missing' }, status: 404, statusText: 'Not Found' })
    await expect(new SupabaseSyncGateway().syncBatch({ inventoryId, deviceId, records: [] })).rejects.toMatchObject({ kind: 'TERMINAL_CONTRACT', retryable: false })
  })

  it('uses the real RPC response status for a contractual PGRST204 / HTTP 400', async () => {
    rpc.mockResolvedValueOnce({ data: null, error: { code: 'PGRST204', message: 'column missing' }, status: 400, statusText: 'Bad Request' })
    await expect(new SupabaseSyncGateway().syncBatch({ inventoryId, deviceId, records: [] })).rejects.toMatchObject({ kind: 'TERMINAL_CONTRACT', retryable: false })
  })
})
