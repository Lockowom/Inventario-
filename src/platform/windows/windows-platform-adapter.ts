import type { PlatformAdapter } from '../contracts'
import { WebPlatformAdapter } from '../web/web-platform-adapter'

/**
 * WIN-02 uses the WebView's existing IndexedDB implementation only to open,
 * authenticate and navigate. It is deliberately not certified for durable
 * Windows offline capture; WIN-06 owns the dedicated SQLite implementation.
 */
export class WindowsPlatformAdapter implements PlatformAdapter {
  private readonly webFallback = new WebPlatformAdapter()

  public readonly capabilities = {
    platform: 'windows',
    isNative: true,
    isNativeAndroid: false,
    supportsNativeScanner: false,
    supportsNativeUpdater: false,
    supportsUsbKeyboardScanner: false,
    hasCertifiedDurableStorage: false,
  } as const

  public readonly storage = this.webFallback.storage
  public readonly scanner = this.webFallback.scanner
  public readonly lifecycle = this.webFallback.lifecycle
  public readonly updater = this.webFallback.updater
}
