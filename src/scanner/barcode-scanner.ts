import { Capacitor } from '@capacitor/core'
import { BarcodeFormat, BarcodeScanner } from '@capacitor-mlkit/barcode-scanning'

export type ScanField = 'ubicacion' | 'codigo' | 'serie' | 'partida'
export type ScanResult = { value: string | null; error: string | null; torchAvailable: boolean }

/** Native fullscreen scanner. It only fills a field; it never saves a count. */
export async function scanBarcodeField(field: ScanField): Promise<ScanResult> {
  // El campo se conserva en el contrato para que la UI pueda aplicar el resultado
  // sin que el adaptador de cámara tenga conocimiento del formulario.
  void field
  if (Capacitor.getPlatform() === 'web') return { value: null, error: 'El scanner nativo no está disponible en la web. Ingrese el valor manualmente.', torchAvailable: false }
  try {
    const support = await BarcodeScanner.isSupported()
    if (!support.supported) return { value: null, error: 'Este dispositivo no dispone de una cámara compatible. Puede ingresar el valor manualmente.', torchAvailable: false }
    if (Capacitor.getPlatform() === 'android') {
      const module = await BarcodeScanner.isGoogleBarcodeScannerModuleAvailable()
      if (!module.available) {
        await BarcodeScanner.installGoogleBarcodeScannerModule()
        return { value: null, error: 'El módulo de scanner de Google se está instalando. Cuando finalice, vuelva a intentar o ingrese el valor manualmente.', torchAvailable: false }
      }
    }
    const permission = await BarcodeScanner.checkPermissions()
    const granted = permission.camera === 'granted' || (await BarcodeScanner.requestPermissions()).camera === 'granted'
    if (!granted) return { value: null, error: 'Permiso de cámara denegado. Puede habilitarlo en Ajustes o ingresar el valor manualmente.', torchAvailable: false }
    const torch = await BarcodeScanner.isTorchAvailable()
    const result = await BarcodeScanner.scan({ formats: [BarcodeFormat.QrCode, BarcodeFormat.Code128], autoZoom: true })
    return { value: result.barcodes[0]?.displayValue?.trim() || null, error: null, torchAvailable: torch.available }
  } catch (error: unknown) {
    return { value: null, error: error instanceof Error ? `No fue posible escanear: ${error.message}` : 'El scanner se canceló o no está disponible. Puede ingresar el valor manualmente.', torchAvailable: false }
  }
}

export async function toggleScannerTorch(): Promise<boolean> {
  try {
    const torch = await BarcodeScanner.isTorchAvailable()
    if (!torch.available) return false
    await BarcodeScanner.toggleTorch()
    return true
  } catch { return false }
}
