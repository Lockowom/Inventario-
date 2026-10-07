import { beforeEach, describe, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => ({
  getPlatform: vi.fn(), isPluginAvailable: vi.fn(), current: vi.fn(), getDeviceId: vi.fn(),
  notifyAppReady: vi.fn(), download: vi.fn(), set: vi.fn(), reload: vi.fn(), reset: vi.fn(),
  getSupabaseClient: vi.fn(), getSession: vi.fn(), invoke: vi.fn(),
}))

vi.mock('@capacitor/core', () => ({ Capacitor: { getPlatform: mocks.getPlatform, isPluginAvailable: mocks.isPluginAvailable } }))
vi.mock('@capgo/capacitor-updater', () => ({ CapacitorUpdater: {
  current: mocks.current, getDeviceId: mocks.getDeviceId, notifyAppReady: mocks.notifyAppReady,
  download: mocks.download, set: mocks.set, reload: mocks.reload, reset: mocks.reset,
} }))
vi.mock('../../src/services/supabase', () => ({ getSupabaseClient: mocks.getSupabaseClient }))

import { bindOtaRetryEvents, compareVersions, OtaUpdateService, shouldRetryOtaForAuthEvent } from '../../src/services/ota-update-service'

const builtin = { native: '1.0.0', bundle: { id: 'builtin', version: 'builtin', downloaded: '', checksum: '', status: 'success' } }
const priorOta = { native: '1.0.0', bundle: { id: 'ota-1', version: '1.0.0-qa.1', downloaded: '', checksum: '', status: 'success' } }
const activeSession = { data: { session: { access_token: 'qa-token' } }, error: null }

function online(value: boolean) { Object.defineProperty(window.navigator, 'onLine', { configurable: true, value }) }

describe('OTA version contract', () => {
  beforeEach(() => {
    vi.clearAllMocks(); online(true)
    vi.spyOn(console, 'error').mockImplementation(() => undefined)
    mocks.getPlatform.mockReturnValue('android')
    mocks.isPluginAvailable.mockReturnValue(true)
    mocks.current.mockResolvedValue(builtin)
    mocks.getDeviceId.mockResolvedValue({ deviceId: 'android-qa-device-01' })
    mocks.getSession.mockResolvedValue(activeSession)
    mocks.getSupabaseClient.mockReturnValue({ auth: { getSession: mocks.getSession }, functions: { invoke: mocks.invoke } })
    mocks.invoke.mockResolvedValue({ data: { update: null, enrollment: 'ASSIGNED_NO_BUNDLE' }, error: null })
    mocks.download.mockResolvedValue({ id: 'downloaded', version: '1.0.1-qa.1' })
  })

  it('never treats an equal or older bundle as an upgrade', () => {
    expect(compareVersions('1.0.0-qa.2', '1.0.0-qa.2')).toBe(0)
    expect(compareVersions('1.0.0-qa.1', '1.0.0-qa.2')).toBeLessThan(0)
    expect(compareVersions('1.0.1-qa.1', '1.0.0-qa.99')).toBeGreaterThan(0)
  })

  it('defers a builtin base APK with no Supabase session without invoking ota-updates', async () => {
    mocks.getSession.mockResolvedValue({ data: { session: null }, error: null })
    const result = await new OtaUpdateService().check()
    expect(result.kind).toBe('DEFERRED')
    expect(mocks.invoke).not.toHaveBeenCalled()
    await new OtaUpdateService().rollback()
    expect(mocks.reset).not.toHaveBeenCalled()
  })

  it('defers a 401 race instead of presenting a rollback error', async () => {
    mocks.invoke.mockResolvedValue({ data: null, error: { message: 'Unauthorized', context: { status: 401 } } })
    const result = await new OtaUpdateService().check()
    expect(result.kind).toBe('DEFERRED')
  })

  it('defers while offline before asking Supabase for a session', async () => {
    online(false)
    const result = await new OtaUpdateService().check()
    expect(result.kind).toBe('DEFERRED')
    expect(mocks.getSession).not.toHaveBeenCalled()
    expect(mocks.invoke).not.toHaveBeenCalled()
  })

  it('returns a neutral no-bundle state after an authenticated QA check', async () => {
    const result = await new OtaUpdateService().check()
    expect(result).toMatchObject({ kind: 'UNASSIGNED', message: 'QA-BETA · SIN ACTUALIZACIÓN DISPONIBLE' })
  })

  it('downloads a newer bundle only after the authenticated manifest is available', async () => {
    mocks.invoke.mockResolvedValueOnce({ data: { update: { version: '1.0.1-qa.1', minNativeVersion: '1.0.0', url: 'https://example.test/ota.zip', sha256: 'a'.repeat(64) } }, error: null })
    mocks.invoke.mockResolvedValueOnce({ data: {}, error: null })
    const result = await new OtaUpdateService().check()
    expect(result).toMatchObject({ kind: 'READY', version: '1.0.1-qa.1' })
    expect(mocks.download).toHaveBeenCalledTimes(1)
    expect(mocks.set).toHaveBeenCalledTimes(1)
  })

  it('does not offer rollback after a real download failure from builtin', async () => {
    mocks.invoke.mockResolvedValue({ data: { update: { version: '1.0.1-qa.1', minNativeVersion: '1.0.0', url: 'https://example.test/ota.zip', sha256: 'a'.repeat(64) } }, error: null })
    mocks.download.mockRejectedValue(new Error('checksum mismatch'))
    const service = new OtaUpdateService()
    const result = await service.check()
    expect(result).toMatchObject({ kind: 'ERROR', canRollback: false })
    await service.rollback()
    expect(mocks.reset).not.toHaveBeenCalled()
  })

  it('permits rollback only after a real OTA failure with a prior OTA bundle', async () => {
    mocks.current.mockResolvedValue(priorOta)
    mocks.invoke.mockResolvedValue({ data: { update: { version: '1.0.1-qa.1', minNativeVersion: '1.0.0', url: 'https://example.test/ota.zip', sha256: 'a'.repeat(64) } }, error: null })
    mocks.download.mockRejectedValue(new Error('checksum mismatch'))
    const service = new OtaUpdateService()
    const result = await service.check()
    expect(result).toMatchObject({ kind: 'ERROR', canRollback: true })
    await service.rollback()
    expect(mocks.reset).toHaveBeenCalledWith({ toLastSuccessful: true })
  })

  it('keeps rollback eligibility when applying fails after an earlier OTA bundle', async () => {
    mocks.current.mockResolvedValue(priorOta)
    const service = new OtaUpdateService()
    await service.check()
    mocks.reload.mockRejectedValue(new Error('apply failed'))
    await expect(service.apply()).resolves.toMatchObject({ kind: 'ERROR', canRollback: true })
  })

  it('shares one in-flight OTA check between concurrent callers', async () => {
    let resolveSession: (value: typeof activeSession) => void = () => undefined
    mocks.getSession.mockReturnValue(new Promise((resolve) => { resolveSession = resolve }))
    const service = new OtaUpdateService()
    const first = service.check(); const second = service.check()
    expect(first).toBe(second)
    resolveSession(activeSession)
    await first
    expect(mocks.invoke).toHaveBeenCalledTimes(1)
  })

  it('retries for login, refreshed token, user update and online recovery, then removes listeners', () => {
    const retry = vi.fn(); let listener: ((event: 'SIGNED_IN' | 'TOKEN_REFRESHED' | 'USER_UPDATED' | 'SIGNED_OUT') => void) | undefined
    const unsubscribe = vi.fn()
    const stop = bindOtaRetryEvents((next) => { listener = next as typeof listener; return { unsubscribe } }, retry)
    listener?.('SIGNED_IN'); listener?.('TOKEN_REFRESHED'); listener?.('USER_UPDATED'); listener?.('SIGNED_OUT')
    window.dispatchEvent(new Event('online'))
    expect(retry).toHaveBeenCalledTimes(4)
    expect(shouldRetryOtaForAuthEvent('SIGNED_OUT')).toBe(false)
    stop(); window.dispatchEvent(new Event('online'))
    expect(unsubscribe).toHaveBeenCalledTimes(1)
    expect(retry).toHaveBeenCalledTimes(4)
  })
})
