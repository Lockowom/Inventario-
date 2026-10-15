import { describe, expect, it, vi } from 'vitest'

const platform = vi.hoisted(() => vi.fn(() => 'web'))
const getInfo = vi.hoisted(() => vi.fn(async () => ({ version: '8.1.0' })))
const getSupabaseClient = vi.hoisted(() => vi.fn())

vi.mock('@capacitor/core', () => ({ Capacitor: { getPlatform: platform } }))
vi.mock('@capacitor/app', () => ({ App: { getInfo } }))
vi.mock('../../src/services/supabase', () => ({ getSupabaseClient }))

import { CapacitorAppVersionProvider } from '../../src/services/app-version-provider'
import { SupabaseServerTimeGateway } from '../../src/services/supabase-server-time-gateway'

describe('device health infrastructure providers', () => {
  it('uses a native App version when available and the configured build fallback otherwise', async () => {
    const expectedBuildVersion = (import.meta.env.VITE_APP_VERSION ?? '0.1.0').trim()
    platform.mockReturnValue('android')
    await expect(new CapacitorAppVersionProvider().getVersion()).resolves.toBe('8.1.0')
    getInfo.mockRejectedValueOnce(new Error('native unavailable'))
    await expect(new CapacitorAppVersionProvider().getVersion()).resolves.toBe(expectedBuildVersion)
    platform.mockReturnValue('web')
    await expect(new CapacitorAppVersionProvider().getVersion()).resolves.toBe(expectedBuildVersion)
  })

  it('uses only the authenticated shared client RPC and normalizes failures', async () => {
    const rpc = vi.fn(async () => ({ data: '2026-09-25T12:00:00.000Z', error: null }))
    getSupabaseClient.mockReturnValue({ rpc })
    await expect(new SupabaseServerTimeGateway().getServerTime()).resolves.toEqual(new Date('2026-09-25T12:00:00.000Z'))
    expect(rpc).toHaveBeenCalledWith('get_server_time')
    getSupabaseClient.mockReturnValue({ rpc: vi.fn(async () => ({ data: null, error: { message: 'hidden' } })) })
    await expect(new SupabaseServerTimeGateway().getServerTime()).resolves.toBeNull()
  })
})
