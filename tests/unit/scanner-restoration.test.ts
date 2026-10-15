import { describe, expect, it } from 'vitest'
import { consumeRestoredScannerResult, processRestoredScannerResult, rememberScannerIntent, type ScannerIntentStore } from '../../src/scanner/scanner-restoration'

class MemoryStore implements ScannerIntentStore {
  private readonly values = new Map<string, string>()
  getItem(key: string) { return this.values.get(key) ?? null }
  setItem(key: string, value: string) { this.values.set(key, value) }
  removeItem(key: string) { this.values.delete(key) }
}

describe('scanner restoration', () => {
  it('restores the scanned value into the original field exactly once', () => {
    const store = new MemoryStore()
    rememberScannerIntent('codigo', store)
    const result = processRestoredScannerResult({
      pluginId: 'BarcodeScanner',
      methodName: 'scan',
      success: true,
      data: { barcodes: [{ displayValue: ' 001234 ' }] },
    } as never, store)

    expect(result).toEqual({ field: 'codigo', value: '001234', error: null })
    expect(consumeRestoredScannerResult(store)).toEqual(result)
    expect(consumeRestoredScannerResult(store)).toBeNull()
  })

  it('a cancelled restoration yields an error and no synthetic value', () => {
    const store = new MemoryStore()
    rememberScannerIntent('serie', store)
    const result = processRestoredScannerResult({
      pluginId: 'BarcodeScanner',
      methodName: 'scan',
      success: false,
      data: null,
      error: { message: 'cancelled' },
    } as never, store)

    expect(result?.field).toBe('serie')
    expect(result?.value).toBeNull()
    expect(result?.error).toMatch(/cancelled/i)
  })

  it('ignores restored results from unrelated plugins', () => {
    const store = new MemoryStore()
    expect(processRestoredScannerResult({ pluginId: 'Other', methodName: 'scan' } as never, store)).toBeNull()
  })
})
