import { beforeEach, describe, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => ({
  platform: 'android',
  isSupported: vi.fn(),
  isGoogleModuleAvailable: vi.fn(),
  installGoogleModule: vi.fn(),
  checkPermissions: vi.fn(),
  requestPermissions: vi.fn(),
  scan: vi.fn(),
  remember: vi.fn(),
  forget: vi.fn(),
}))

vi.mock('@capacitor/core', () => ({
  Capacitor: { getPlatform: () => mocks.platform },
}))

vi.mock('@capacitor-mlkit/barcode-scanning', () => ({
  BarcodeFormat: { QrCode: 'QrCode', Code128: 'Code128' },
  BarcodeScanner: {
    isSupported: mocks.isSupported,
    isGoogleBarcodeScannerModuleAvailable: mocks.isGoogleModuleAvailable,
    installGoogleBarcodeScannerModule: mocks.installGoogleModule,
    checkPermissions: mocks.checkPermissions,
    requestPermissions: mocks.requestPermissions,
    scan: mocks.scan,
  },
}))

vi.mock('../../src/scanner/scanner-restoration', () => ({
  rememberScannerIntent: mocks.remember,
  forgetScannerIntent: mocks.forget,
}))

import { scanBarcodeField } from '../../src/scanner/barcode-scanner'

describe('barcode scanner adapter', () => {
  beforeEach(() => {
    mocks.platform = 'android'
    mocks.isSupported.mockReset().mockResolvedValue({ supported: true })
    mocks.isGoogleModuleAvailable.mockReset().mockResolvedValue({ available: true })
    mocks.installGoogleModule.mockReset().mockResolvedValue(undefined)
    mocks.checkPermissions.mockReset().mockResolvedValue({ camera: 'granted' })
    mocks.requestPermissions.mockReset().mockResolvedValue({ camera: 'granted' })
    mocks.scan.mockReset().mockResolvedValue({ barcodes: [{ displayValue: ' 001234 ' }] })
    mocks.remember.mockReset()
    mocks.forget.mockReset()
  })

  it('scans QR/Code128, trims the value and never saves by itself', async () => {
    await expect(scanBarcodeField('codigo')).resolves.toEqual({ value: '001234', error: null })
    expect(mocks.remember).toHaveBeenCalledWith('codigo')
    expect(mocks.scan).toHaveBeenCalledWith({ formats: ['QrCode', 'Code128'], autoZoom: true })
    expect(mocks.forget).toHaveBeenCalledTimes(1)
  })

  it('installs the Google module and defers scanning when it is missing', async () => {
    mocks.isGoogleModuleAvailable.mockResolvedValue({ available: false })
    const result = await scanBarcodeField('serie')
    expect(mocks.installGoogleModule).toHaveBeenCalledTimes(1)
    expect(mocks.scan).not.toHaveBeenCalled()
    expect(result.value).toBeNull()
    expect(result.error).toMatch(/módulo de scanner de Google/i)
  })

  it('cancellation/failure clears the pending intent and returns manual fallback', async () => {
    mocks.scan.mockRejectedValue(new Error('cancelled'))
    const result = await scanBarcodeField('ubicacion')
    expect(mocks.remember).toHaveBeenCalledWith('ubicacion')
    expect(mocks.forget).toHaveBeenCalledTimes(1)
    expect(result).toEqual({ value: null, error: 'No fue posible escanear: cancelled' })
  })

  it('web never invokes the native scanner', async () => {
    mocks.platform = 'web'
    const result = await scanBarcodeField('partida')
    expect(mocks.scan).not.toHaveBeenCalled()
    expect(result.error).toMatch(/no está disponible en la web/i)
  })
})
