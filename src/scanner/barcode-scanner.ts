import { Capacitor } from '@capacitor/core'
import { BarcodeFormat, BarcodeScanner } from '@capacitor-mlkit/barcode-scanning'
import { forgetScannerIntent, rememberScannerIntent } from './scanner-restoration'

export type ScanField = 'ubicacion' | 'codigo' | 'serie' | 'partida'
export type ScanResult = { value: string | null; error: string | null }

/** Native fullscreen scanner. It only fills a field; it never saves a count. */
export async function scanBarcodeField(field: ScanField): Promise<ScanResult> {
  // El campo se conserva en el contrato para que la UI pueda aplicar el resultado
  // sin que el adaptador de cámara tenga conocimiento del formulario.
  void field
  const platform = Capacitor.getPlatform()
  if (platform === 'web') return { value: null, error: 'El scanner nativo no está disponible en la web. Ingrese el valor manualmente.' }
  try {
    const support = await BarcodeScanner.isSupported()
    if (!support.supported) return { value: null, error: 'Este dispositivo no dispone de una cámara compatible. Puede ingresar el valor manualmente.' }
    if (platform === 'android') {
      const module = await BarcodeScanner.isGoogleBarcodeScannerModuleAvailable()
      if (!module.available) {
        await BarcodeScanner.installGoogleBarcodeScannerModule()
        return { value: null, error: 'El módulo de scanner de Google se está instalando. Cuando finalice, vuelva a intentar o ingrese el valor manualmente.' }
      }
    }
    if (platform === 'ios') {
      const permission = await BarcodeScanner.checkPermissions()
      const granted = permission.camera === 'granted' || (await BarcodeScanner.requestPermissions()).camera === 'granted'
      if (!granted) return { value: null, error: 'Permiso de cámara denegado. Puede habilitarlo en Ajustes o ingresar el valor manualmente.' }
    }
    rememberScannerIntent(field)
    const result = await BarcodeScanner.scan({ formats: [BarcodeFormat.QrCode, BarcodeFormat.Code128], autoZoom: true })
    forgetScannerIntent()
    return { value: result.barcodes[0]?.displayValue?.trim() || null, error: null }
  } catch (error: unknown) {
    forgetScannerIntent()
    return { value: null, error: error instanceof Error ? `No fue posible escanear: ${error.message}` : 'El scanner se canceló o no está disponible. Puede ingresar el valor manualmente.' }
  }
}
