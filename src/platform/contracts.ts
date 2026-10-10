import type { AppVersionProvider, LocalHealthProbe, PassiveScannerHealthProbe } from '../domain/device-health/contracts'
import type { CountRepository } from '../domain/ports/count-repository'
import type { CountingContextRepository } from '../domain/ports/counting-context-repository'
import type { MasterSkuRepository } from '../domain/ports/master-sku-repository'

/**
 * Platform boundary for INVEN3. Domain and feature use-cases depend on the
 * existing repositories and ports; only composition knows how a platform
 * persists data, scans a barcode, resumes its lifecycle or updates itself.
 */
export type RuntimePlatform = 'web' | 'android' | 'ios' | 'windows'

export type ScanField = 'ubicacion' | 'codigo' | 'serie' | 'partida'
export type ScanResult = { value: string | null; error: string | null }
export type RestoredScannerEvent = {
  pluginId?: unknown
  methodName?: unknown
  success?: unknown
  data?: unknown
  error?: { message?: unknown } | null
}
export type RestoredScannerResult = { field: ScanField | null; value: string | null; error: string | null }

export interface PlatformCapabilities {
  platform: RuntimePlatform
  isNative: boolean
  isNativeAndroid: boolean
  supportsNativeScanner: boolean
  supportsNativeUpdater: boolean
  supportsUsbKeyboardScanner: boolean
  /** True only after the platform's local storage has been certified for inventory capture. */
  hasCertifiedDurableStorage: boolean
}

export interface StorageAdapter {
  countingContextRepository(): CountingContextRepository
  countRepository(): CountRepository
  masterSkuRepository(): MasterSkuRepository
  localHealthProbe(): LocalHealthProbe
}

export interface ScannerAdapter {
  scan(field: ScanField): Promise<ScanResult>
  healthProbe(): PassiveScannerHealthProbe
  subscribeToRestoration(listener: (result: RestoredScannerResult) => void): Promise<() => Promise<void>>
}

export type LifecycleAdapter = Pick<AppVersionProvider, 'getVersion'>

export type CurrentUpdateBundle = {
  native: string
  bundle: { id: string; version: string }
}

export interface UpdateAdapter {
  isAvailable(): boolean
  notifyLaunchReady(): Promise<void>
  current(): Promise<CurrentUpdateBundle>
  getDeviceId(): Promise<string>
  download(input: { version: string; url: string; checksum: string }): Promise<unknown>
  set(bundle: unknown): Promise<void>
  reload(): Promise<void>
  resetToLastSuccessful(): Promise<void>
}

export interface PlatformAdapter {
  capabilities: PlatformCapabilities
  storage: StorageAdapter
  scanner: ScannerAdapter
  lifecycle: LifecycleAdapter
  updater: UpdateAdapter
}
