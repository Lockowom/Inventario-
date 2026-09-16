import { App, type RestoredListenerEvent } from '@capacitor/app'
import { Capacitor, type PluginListenerHandle } from '@capacitor/core'
import type { ScanField } from './barcode-scanner'

const FIELD_KEY = 'inven3.pending-scan-field'
const RESULT_KEY = 'inven3.restored-scan-result'

export interface ScannerIntentStore { getItem(key: string): string | null; setItem(key: string, value: string): void; removeItem(key: string): void }
export interface RestoredScanResult { field: ScanField | null; value: string | null; error: string | null }

function store(): ScannerIntentStore | null { return typeof localStorage === 'undefined' ? null : localStorage }
export function rememberScannerIntent(field: ScanField, target = store()): void { target?.setItem(FIELD_KEY, field) }
export function forgetScannerIntent(target = store()): void { target?.removeItem(FIELD_KEY) }

export function consumeRestoredScannerResult(target = store()): RestoredScanResult | null {
  const serialized = target?.getItem(RESULT_KEY)
  if (!serialized) return null
  target?.removeItem(RESULT_KEY)
  try {
    const parsed: unknown = JSON.parse(serialized)
    if (!parsed || typeof parsed !== 'object') return null
    const value = parsed as Partial<RestoredScanResult>
    const field = value.field === 'codigo' || value.field === 'serie' || value.field === 'partida' || value.field === 'ubicacion' ? value.field : null
    return { field, value: typeof value.value === 'string' ? value.value : null, error: typeof value.error === 'string' ? value.error : null }
  } catch { return null }
}

export function processRestoredScannerResult(event: RestoredListenerEvent, target = store()): RestoredScanResult | null {
  if (event.pluginId !== 'BarcodeScanner' || event.methodName !== 'scan') return null
  const field = target?.getItem(FIELD_KEY) as ScanField | null
  target?.removeItem(FIELD_KEY)
  const value = event.success ? scannerValue(event.data) : null
  const result: RestoredScanResult = event.success && value
    ? { field, value, error: field ? null : 'Se recuperó un resultado de scanner sin campo de destino. Ingréselo manualmente.' }
    : { field, value: null, error: event.error?.message ? `No fue posible restaurar el scanner: ${event.error.message}` : 'No fue posible restaurar el resultado del scanner. Ingrese el valor manualmente.' }
  target?.setItem(RESULT_KEY, JSON.stringify(result))
  return result
}

function scannerValue(data: unknown): string | null {
  if (!data || typeof data !== 'object' || !Array.isArray((data as { barcodes?: unknown }).barcodes)) return null
  const first = (data as { barcodes: Array<{ displayValue?: unknown }> }).barcodes[0]
  return typeof first?.displayValue === 'string' && first.displayValue.trim() ? first.displayValue.trim() : null
}

export async function subscribeToScannerRestoration(listener: (result: RestoredScanResult) => void): Promise<() => Promise<void>> {
  if (Capacitor.getPlatform() !== 'android') return async () => undefined
  const handle: PluginListenerHandle = await App.addListener('appRestoredResult', (event) => {
    const result = processRestoredScannerResult(event)
    if (result) listener(result)
  })
  return async () => handle.remove()
}
