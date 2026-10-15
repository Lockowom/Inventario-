import type { DeviceHealthCheck, DeviceHealthMode, PassiveScannerHealthProbe } from '../../domain/device-health/contracts'
import { setScannerComponentStatus } from '../../scanner/scanner-component-status'
import type { PlatformAdapter, RestoredScannerResult, ScanField, ScanResult } from '../contracts'
import { WebStorageAdapter } from './web-storage-adapter'

class WebScannerHealthProbe implements PassiveScannerHealthProbe {
  public async probe(mode: DeviceHealthMode): Promise<readonly DeviceHealthCheck[]> {
    void mode
    return [
      { key: 'CAMERA_AVAILABLE', status: 'UNAVAILABLE', blocking: false, message: 'Cámara nativa no disponible en esta plataforma; puede ingresar los datos manualmente.' },
      { key: 'CAMERA_PERMISSION', status: 'UNAVAILABLE', blocking: false, message: 'No se requiere permiso de cámara para la digitación manual.' },
      { key: 'SCANNER_AVAILABLE', status: 'UNAVAILABLE', blocking: false, message: 'Scanner nativo no disponible; puede ingresar los datos manualmente.' },
    ]
  }
}

class WebScannerAdapter {
  public async scan(field: ScanField): Promise<ScanResult> {
    void field
    const message = 'El scanner nativo no está disponible en la web. Ingrese el valor manualmente.'
    setScannerComponentStatus({ kind: 'UNAVAILABLE', message: 'El scanner nativo no está disponible en la web.' })
    return { value: null, error: message }
  }

  public healthProbe(): PassiveScannerHealthProbe { return new WebScannerHealthProbe() }
  public async subscribeToRestoration(listener: (result: RestoredScannerResult) => void): Promise<() => Promise<void>> {
    void listener
    return async () => undefined
  }
}

class WebLifecycleAdapter {
  public async getVersion(): Promise<string | null> {
    const value = (import.meta.env.VITE_APP_VERSION ?? '0.1.0').trim()
    return value || null
  }
}

class UnavailableUpdateAdapter {
  public isAvailable(): boolean { return false }
  public async notifyLaunchReady(): Promise<void> { /* Web has no native OTA acknowledgement. */ }
  public async current(): Promise<never> { throw new Error('Native updater unavailable') }
  public async getDeviceId(): Promise<never> { throw new Error('Native updater unavailable') }
  public async download(input: { version: string; url: string; checksum: string }): Promise<never> {
    void input
    throw new Error('Native updater unavailable')
  }
  public async set(bundle: unknown): Promise<void> {
    void bundle
    throw new Error('Native updater unavailable')
  }
  public async reload(): Promise<void> { throw new Error('Native updater unavailable') }
  public async resetToLastSuccessful(): Promise<void> { throw new Error('Native updater unavailable') }
}

export class WebPlatformAdapter implements PlatformAdapter {
  public readonly capabilities = { platform: 'web', isNative: false, isNativeAndroid: false, supportsNativeScanner: false, supportsNativeUpdater: false, supportsUsbKeyboardScanner: false, hasCertifiedDurableStorage: true } as const
  public readonly storage = new WebStorageAdapter()
  public readonly scanner = new WebScannerAdapter()
  public readonly lifecycle = new WebLifecycleAdapter()
  public readonly updater = new UnavailableUpdateAdapter()
}
