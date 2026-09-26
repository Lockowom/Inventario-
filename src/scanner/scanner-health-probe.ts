import { Capacitor } from '@capacitor/core'
import { BarcodeScanner } from '@capacitor-mlkit/barcode-scanning'
import type { DeviceHealthCheck, DeviceHealthMode, PassiveScannerHealthProbe } from '../domain/device-health/contracts'

/** Passive capability inspection only: it never scans, requests permission, or installs a module. */
export class CapacitorScannerHealthProbe implements PassiveScannerHealthProbe {
  public async probe(mode: DeviceHealthMode): Promise<readonly DeviceHealthCheck[]> {
    void mode
    const platform = Capacitor.getPlatform()
    try {
      const support = await BarcodeScanner.isSupported()
      const camera: DeviceHealthCheck = support.supported
        ? { key: 'CAMERA_AVAILABLE', status: 'PASS', blocking: false, message: 'Cámara compatible disponible.' }
        : { key: 'CAMERA_AVAILABLE', status: 'UNAVAILABLE', blocking: false, message: 'Cámara no disponible; puede ingresar los datos manualmente.' }
      if (platform === 'android') return [camera, { key: 'CAMERA_PERMISSION', status: 'UNAVAILABLE', blocking: false, message: 'El scanner de Google no requiere permiso de cámara de INVEN3.' }, await this.checkAndroidModule(support.supported)]
      if (platform === 'ios') return [camera, await this.checkIosPermission(), scannerCheck(support.supported)]
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

function scannerCheck(supported: boolean): DeviceHealthCheck {
  return supported
    ? { key: 'SCANNER_AVAILABLE', status: 'PASS', blocking: false, message: 'Scanner disponible.' }
    : { key: 'SCANNER_AVAILABLE', status: 'UNAVAILABLE', blocking: false, message: 'Scanner no disponible; puede ingresar los datos manualmente.' }
}
