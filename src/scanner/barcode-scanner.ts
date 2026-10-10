import { getPlatformAdapter } from '../platform/runtime-platform'
import type { ScanField, ScanResult } from '../platform/contracts'

export type { ScanField, ScanResult } from '../platform/contracts'

/** Native fullscreen scanner. It only fills a field; it never saves a count. */
export async function scanBarcodeField(field: ScanField): Promise<ScanResult> {
  return getPlatformAdapter().scanner.scan(field)
}
