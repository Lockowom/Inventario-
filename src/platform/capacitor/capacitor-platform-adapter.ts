import { App } from '@capacitor/app'
import { Capacitor } from '@capacitor/core'
import { BarcodeFormat, BarcodeScanner } from '@capacitor-mlkit/barcode-scanning'
import { CapacitorUpdater } from '@capgo/capacitor-updater'
import type { DeviceHealthCheck, DeviceHealthMode, PassiveScannerHealthProbe } from '../../domain/device-health/contracts'
import { forgetScannerIntent, processRestoredScannerResult, rememberScannerIntent } from '../../scanner/scanner-restoration'
import { setScannerComponentStatus } from '../../scanner/scanner-component-status'
import type { PlatformAdapter, RestoredScannerResult, ScanField, ScanResult } from '../contracts'
import { CapacitorStorageAdapter } from './capacitor-storage-adapter'

function platform() { return Capacitor.getPlatform() }
function scannerCheck(supported: boolean): DeviceHealthCheck {
  return supported
    ? { key: 'SCANNER_AVAILABLE', status: 'PASS', blocking: false, message: 'Scanner disponible.' }
    : { key: 'SCANNER_AVAILABLE', status: 'UNAVAILABLE', blocking: false, message: 'Scanner no disponible; puede ingresar los datos manualmente.' }
}

class CapacitorScannerHealthProbe implements PassiveScannerHealthProbe {
  public async probe(mode: DeviceHealthMode): Promise<readonly DeviceHealthCheck[]> {
    void mode
    try {
      const support = await BarcodeScanner.isSupported()
      const camera: DeviceHealthCheck = support.supported
        ? { key: 'CAMERA_AVAILABLE', status: 'PASS', blocking: false, message: 'Cámara compatible disponible.' }
        : { key: 'CAMERA_AVAILABLE', status: 'UNAVAILABLE', blocking: false, message: 'Cámara no disponible; puede ingresar los datos manualmente.' }
      if (platform() === 'android') return [camera, { key: 'CAMERA_PERMISSION', status: 'UNAVAILABLE', blocking: false, message: 'El scanner de Google no requiere permiso de cámara de INVEN3.' }, await this.checkAndroidModule(support.supported)]
      if (platform() === 'ios') return [camera, await this.checkIosPermission(), scannerCheck(support.supported)]
      return [camera, { key: 'CAMERA_PERMISSION', status: 'UNAVAILABLE', blocking: false, message: 'No fue posible comprobar el permiso de cámara sin abrirla.' }, scannerCheck(support.supported)]
    } catch {
      return [
        { key: 'CAMERA_AVAILABLE', status: 'UNAVAILABLE', blocking: false, message: 'Cámara no disponible; puede ingresar los datos manualmente.' },
        { key: 'CAMERA_PERMISSION', status: 'UNAVAILABLE', blocking: false, message: 'No fue posible comprobar el permiso de cámara sin abrirla.' },
        { key: 'SCANNER_AVAILABLE', status: 'UNAVAILABLE', blocking: false, message: 'Scanner no disponible; puede ingresar los datos manualmente.' },
      ]
    }
  }

  private async checkAndroidModule(supported: boolean): Promise<DeviceHealthCheck> {
    if (!supported) return scannerCheck(false)
    try {
      const module = await BarcodeScanner.isGoogleBarcodeScannerModuleAvailable()
      return module.available
        ? { key: 'SCANNER_AVAILABLE', status: 'PASS', blocking: false, message: 'Scanner disponible.' }
        : { key: 'SCANNER_AVAILABLE', status: 'WARN', blocking: false, message: 'Scanner no disponible; puede ingresar los datos manualmente.' }
    } catch { return { key: 'SCANNER_AVAILABLE', status: 'UNAVAILABLE', blocking: false, message: 'Scanner no disponible; puede ingresar los datos manualmente.' } }
  }

  private async checkIosPermission(): Promise<DeviceHealthCheck> {
    try {
      const permission = await BarcodeScanner.checkPermissions()
      return permission.camera === 'granted'
        ? { key: 'CAMERA_PERMISSION', status: 'PASS', blocking: false, message: 'Permiso de cámara concedido.' }
        : { key: 'CAMERA_PERMISSION', status: 'WARN', blocking: false, message: 'Permiso de cámara no concedido; puede ingresar los datos manualmente.' }
    } catch { return { key: 'CAMERA_PERMISSION', status: 'UNAVAILABLE', blocking: false, message: 'No fue posible comprobar el permiso de cámara sin abrirla.' } }
  }
}

class CapacitorScannerAdapter {
  public async scan(field: ScanField): Promise<ScanResult> {
    try {
      const support = await BarcodeScanner.isSupported()
      if (!support.supported) {
        setScannerComponentStatus({ kind: 'UNAVAILABLE', message: 'Este dispositivo no dispone de una cámara compatible.' })
        return { value: null, error: 'Este dispositivo no dispone de una cámara compatible. Puede ingresar el valor manualmente.' }
      }
      if (platform() === 'android') {
        const module = await BarcodeScanner.isGoogleBarcodeScannerModuleAvailable()
        if (!module.available) {
          setScannerComponentStatus({ kind: 'PREPARING', message: 'Descargando y preparando el componente de scanner…' })
          await BarcodeScanner.installGoogleBarcodeScannerModule()
          return { value: null, error: 'El módulo de scanner de Google se está instalando. Cuando finalice, vuelva a intentar o ingrese el valor manualmente.' }
        }
      }
      if (platform() === 'ios') {
        const permission = await BarcodeScanner.checkPermissions()
        const granted = permission.camera === 'granted' || (await BarcodeScanner.requestPermissions()).camera === 'granted'
        if (!granted) {
          setScannerComponentStatus({ kind: 'UNAVAILABLE', message: 'Permiso de cámara denegado.' })
          return { value: null, error: 'Permiso de cámara denegado. Puede habilitarlo en Ajustes o ingresar el valor manualmente.' }
        }
      }
      setScannerComponentStatus({ kind: 'READY', message: 'Scanner listo.' })
      rememberScannerIntent(field)
      const result = await BarcodeScanner.scan({ formats: [BarcodeFormat.QrCode, BarcodeFormat.Code128], autoZoom: true })
      forgetScannerIntent()
      return { value: result.barcodes[0]?.displayValue?.trim() || null, error: null }
    } catch (error: unknown) {
      forgetScannerIntent()
      setScannerComponentStatus({ kind: 'UNAVAILABLE', message: 'No fue posible abrir el scanner.' })
      return { value: null, error: error instanceof Error ? `No fue posible escanear: ${error.message}` : 'El scanner se canceló o no está disponible. Puede ingresar el valor manualmente.' }
    }
  }

  public healthProbe(): PassiveScannerHealthProbe { return new CapacitorScannerHealthProbe() }

  public async subscribeToRestoration(listener: (result: RestoredScannerResult) => void): Promise<() => Promise<void>> {
    if (platform() !== 'android') return async () => undefined
    const handle = await App.addListener('appRestoredResult', (event) => {
      const result = processRestoredScannerResult(event)
      if (result) listener(result)
    })
    return async () => handle.remove()
  }
}

class CapacitorLifecycleAdapter {
  public async getVersion(): Promise<string | null> {
    try {
      const version = (await App.getInfo()).version.trim()
      if (version) return version
    } catch { /* Build metadata is the safe fallback. */ }
    const fallback = (import.meta.env.VITE_APP_VERSION ?? '0.1.0').trim()
    return fallback || null
  }
}

class CapgoAndroidUpdateAdapter {
  public isAvailable(): boolean { return platform() === 'android' && Capacitor.isPluginAvailable('CapacitorUpdater') }
  public async notifyLaunchReady(): Promise<void> { if (this.isAvailable()) await CapacitorUpdater.notifyAppReady() }
  public async current() { return CapacitorUpdater.current() }
  public async getDeviceId(): Promise<string> { return (await CapacitorUpdater.getDeviceId()).deviceId }
  public async download(input: { version: string; url: string; checksum: string }): Promise<unknown> { return CapacitorUpdater.download(input) }
  public async set(bundle: unknown): Promise<void> { await CapacitorUpdater.set(bundle as Parameters<typeof CapacitorUpdater.set>[0]) }
  public async reload(): Promise<void> { await CapacitorUpdater.reload() }
  public async resetToLastSuccessful(): Promise<void> { await CapacitorUpdater.reset({ toLastSuccessful: true }) }
}

export class CapacitorPlatformAdapter implements PlatformAdapter {
  public readonly capabilities = {
    get platform() { const current = platform(); return current === 'android' || current === 'ios' ? current : 'web' },
    get isNative() { return platform() !== 'web' },
    get isNativeAndroid() { return platform() === 'android' },
    get supportsNativeScanner() { return platform() === 'android' || platform() === 'ios' },
    get supportsNativeUpdater() { return platform() === 'android' && Capacitor.isPluginAvailable('CapacitorUpdater') },
    supportsUsbKeyboardScanner: false,
    hasCertifiedDurableStorage: true,
  }
  public readonly storage = new CapacitorStorageAdapter()
  public readonly scanner = new CapacitorScannerAdapter()
  public readonly lifecycle = new CapacitorLifecycleAdapter()
  public readonly updater = new CapgoAndroidUpdateAdapter()
}
