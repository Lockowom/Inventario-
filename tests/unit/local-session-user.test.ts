import { beforeEach, describe, expect, it, vi } from 'vitest'

const getSession = vi.hoisted(() => vi.fn())

vi.mock('../../src/services/supabase', () => ({
  getSupabaseClient: () => ({ auth: { getSession } }),
}))

import { getLocalSessionUserId } from '../../src/features/counting/authorized-counting-context'
import { persistAuthUserId } from '../../src/services/local-auth-identity'

const userId = '22222222-2222-4222-8222-222222222222'

describe('getLocalSessionUserId offline identity', () => {
  beforeEach(() => {
    localStorage.clear()
    getSession.mockReset()
  })

  it('returns the live session user and refreshes the durable identity', async () => {
    getSession.mockResolvedValue({ data: { session: { user: { id: userId } } }, error: null })
    await expect(getLocalSessionUserId()).resolves.toBe(userId)
  })

  it('falls back to durable identity only on an explicit unavailable Auth failure', async () => {
    persistAuthUserId(userId)
    getSession.mockResolvedValue({
      data: { session: null },
      error: { name: 'AuthRetryableFetchError', status: 0, message: 'Failed to fetch' },
    })
    await expect(getLocalSessionUserId()).resolves.toBe(userId)
  })

  it('uses durable identity when Supabase returns a transient null session after offline restart', async () => {
    persistAuthUserId(userId)
    getSession.mockResolvedValue({ data: { session: null }, error: null })
    await expect(getLocalSessionUserId()).resolves.toBe(userId)
  })
})
