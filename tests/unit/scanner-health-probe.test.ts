import { describe, expect, it, vi } from 'vitest'

const platform = vi.hoisted(() => vi.fn(() => 'android'))
const scanner = vi.hoisted(() => ({
  isSupported: vi.fn(async () => ({ supported: true })),
  isGoogleBarcodeScannerModuleAvailable: vi.fn(async () => ({ available: true })),
  checkPermissions: vi.fn(async () => ({ camera: 'granted' })),
  scan: vi.fn(),
  requestPermissions: vi.fn(),
  installGoogleBarcodeScannerModule: vi.fn(),
}))

vi.mock('@capacitor/core', () => ({ Capacitor: { getPlatform: platform } }))
vi.mock('@capacitor-mlkit/barcode-scanning', () => ({ BarcodeScanner: scanner }))

import { CapacitorScannerHealthProbe } from '../../src/scanner/scanner-health-probe'

describe('CapacitorScannerHealthProbe', () => {
  it('checks Android capabilities passively and never requests camera access or scans', async () => {
    platform.mockReturnValue('android')
    const checks = await new CapacitorScannerHealthProbe().probe('FULL')
    expect(checks).toMatchObject([
      { key: 'CAMERA_AVAILABLE', status: 'PASS', blocking: false },
      { key: 'CAMERA_PERMISSION', status: 'UNAVAILABLE', blocking: false },
      { key: 'SCANNER_AVAILABLE', status: 'PASS', blocking: false },
    ])
    expect(scanner.isSupported).toHaveBeenCalledOnce()
    expect(scanner.isGoogleBarcodeScannerModuleAvailable).toHaveBeenCalledOnce()
    expect(scanner.scan).not.toHaveBeenCalled()
    expect(scanner.requestPermissions).not.toHaveBeenCalled()
    expect(scanner.installGoogleBarcodeScannerModule).not.toHaveBeenCalled()
  })

  it('keeps an unavailable Android scanner non-blocking', async () => {
    scanner.isGoogleBarcodeScannerModuleAvailable.mockResolvedValueOnce({ available: false })
    const checks = await new CapacitorScannerHealthProbe().probe('LIGHT')
    expect(checks.find((check) => check.key === 'SCANNER_AVAILABLE')).toMatchObject({ status: 'WARN', blocking: false })
  })
})
