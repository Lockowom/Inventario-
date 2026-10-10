import { describe, expect, it } from 'vitest'
import { getPlatformAdapterForRuntime, resolveRuntimePlatform } from '../../src/platform/runtime-platform'
import { CapacitorPlatformAdapter } from '../../src/platform/capacitor/capacitor-platform-adapter'
import { WebPlatformAdapter } from '../../src/platform/web/web-platform-adapter'

describe('WIN-02 Windows platform adapter', () => {
  it('selects Windows before the Web Capacitor fallback when Tauri is available', () => {
    expect(resolveRuntimePlatform({ tauri: true, capacitorPlatform: 'web' })).toBe('windows')
    expect(getPlatformAdapterForRuntime({ tauri: true, capacitorPlatform: 'web' }).capabilities.platform).toBe('windows')
  })

  it('keeps Android and Web on their existing adapters', () => {
    expect(resolveRuntimePlatform({ tauri: false, capacitorPlatform: 'android' })).toBe('android')
    expect(getPlatformAdapterForRuntime({ tauri: false, capacitorPlatform: 'android' })).toBeInstanceOf(CapacitorPlatformAdapter)
    expect(getPlatformAdapterForRuntime({ tauri: false, capacitorPlatform: 'web' })).toBeInstanceOf(WebPlatformAdapter)
  })

  it('does not claim Windows-only capabilities before their dedicated phases', async () => {
    const windows = getPlatformAdapterForRuntime({ tauri: true, capacitorPlatform: 'web' })
    expect(windows.capabilities).toMatchObject({
      isNative: true,
      isNativeAndroid: false,
      supportsNativeScanner: false,
      supportsNativeUpdater: false,
      supportsUsbKeyboardScanner: false,
      hasCertifiedDurableStorage: false,
    })
    expect(windows.updater.isAvailable()).toBe(false)
    const checks = await windows.scanner.healthProbe().probe('FULL')
    expect(checks).toHaveLength(3)
    expect(checks.every((check) => check.blocking === false)).toBe(true)
  })
})
