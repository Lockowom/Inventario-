import { describe, expect, it } from 'vitest'
import { resolveCountingContext } from '../../src/domain/count/resolve-counting-context'
import type { CachedCountingContext, CountingContextRepository } from '../../src/domain/ports/counting-context-repository'
import { classifyAuthError, classifyPostgrestError } from '../../src/features/counting/supabase-error-classification'

const cached: CachedCountingContext = { userId: '22222222-2222-4222-8222-222222222222', inventoryId: '11111111-1111-4111-8111-111111111111', inventoryStatus: 'ABIERTO', verifiedAt: '2026-09-16T12:00:00.000Z' }

class MemoryContextRepository implements CountingContextRepository {
  public value: CachedCountingContext | null = cached
  public async get() { return this.value }
  public async save(context: CachedCountingContext) { this.value = context }
  public async clear() { this.value = null }
}

describe('clasificación fail-closed de Supabase', () => {
  it.each([401, 403])('Auth %i es NOT_AUTHORIZED', (status) => {
    expect(classifyAuthError({ status, code: 'bad_jwt' })).toEqual({ kind: 'NOT_AUTHORIZED' })
  })

  it('Auth 503 inequívoco es UNAVAILABLE', () => {
    expect(classifyAuthError({ status: 503, code: 'unexpected_failure' })).toEqual({ kind: 'UNAVAILABLE' })
  })

  it('un error Auth desconocido es AMBIGUOUS', () => {
    expect(classifyAuthError({ code: 'unexpected_failure' })).toEqual({ kind: 'AMBIGUOUS' })
  })

  it('PostgREST 403 / 42501 es NOT_AUTHORIZED', () => {
    expect(classifyPostgrestError({ error: { code: '42501', message: 'permission denied' }, status: 403 })).toEqual({ kind: 'NOT_AUTHORIZED' })
  })

  it('PostgREST 404 / 42P01 es AMBIGUOUS', () => {
    expect(classifyPostgrestError({ error: { code: '42P01', message: 'undefined table' }, status: 404 })).toEqual({ kind: 'AMBIGUOUS' })
  })

  it('PostgREST 400 contractual es AMBIGUOUS', () => {
    expect(classifyPostgrestError({ error: { code: 'PGRST116', message: 'contract error' }, status: 400 })).toEqual({ kind: 'AMBIGUOUS' })
  })

  it('un error PostgREST sin status reconocido es AMBIGUOUS', () => {
    expect(classifyPostgrestError({ error: { code: 'XX000', message: 'unknown backend failure' }, status: undefined })).toEqual({ kind: 'AMBIGUOUS' })
  })

  it('HTTP 503 inequívoco es UNAVAILABLE', () => {
    expect(classifyPostgrestError({ error: { code: '', message: 'Service Unavailable' }, status: 503 })).toEqual({ kind: 'UNAVAILABLE' })
  })

  it('un rechazo fetch inequívoco con status 0 es UNAVAILABLE', () => {
    expect(classifyPostgrestError({ error: { code: '', message: 'TypeError: Failed to fetch' }, status: 0 })).toEqual({ kind: 'UNAVAILABLE' })
  })

  it('42501 elimina cache y bloquea, nunca usa fallback offline', async () => {
    const cache = new MemoryContextRepository()
    const serverResult = classifyPostgrestError({ error: { code: '42501', message: 'permission denied' }, status: 403 })
    await expect(resolveCountingContext({ verifyServer: async () => serverResult, getLocalSessionUserId: async () => cached.userId }, cache)).resolves.toEqual({ kind: 'BLOCKED', reason: 'NOT_AUTHORIZED' })
    expect(cache.value).toBeNull()
  })
})
