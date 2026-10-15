import type { ResolvedCountingContext } from '../count/resolve-counting-context'

export const DEVICE_HEALTH_CHECK_KEYS = [
  'APP_VERSION', 'AUTH_USER', 'INVENTORY_CONTEXT', 'MASTER_SNAPSHOT', 'LOCAL_DATABASE', 'LOCAL_STORAGE',
  'BACKEND_CONNECTIVITY', 'DEVICE_TIME', 'CAMERA_AVAILABLE', 'CAMERA_PERMISSION', 'SCANNER_AVAILABLE',
] as const

export type DeviceHealthCheckKey = typeof DEVICE_HEALTH_CHECK_KEYS[number]
export type HealthCheckStatus = 'PASS' | 'WARN' | 'FAIL' | 'UNAVAILABLE'
export type DeviceHealthOverall = 'READY' | 'READY_OFFLINE' | 'READY_WITH_WARNINGS' | 'BLOCKED'
export type DeviceHealthMode = 'LIGHT' | 'FULL'

export interface DeviceHealthCheck {
  key: DeviceHealthCheckKey
  status: HealthCheckStatus
  blocking: boolean
  message: string
  observedValue?: string | number
  durationMs?: number
}

export interface DeviceHealthReport {
  mode: DeviceHealthMode
  overall: DeviceHealthOverall
  checks: readonly DeviceHealthCheck[]
  resolvedContext: ResolvedCountingContext
  checkedAt: string
}

export interface LocalStorageEstimate {
  usage?: number
  quota?: number
}

/** Infrastructure reports semantics only; no SQL, Dexie or platform type leaks into domain. */
export interface LocalHealthProbeResult {
  databaseOperational: boolean
  persistenceOperational: boolean
  storageEstimate: LocalStorageEstimate | null
}

export interface LocalHealthProbe {
  probe(): Promise<LocalHealthProbeResult>
}

export interface AppVersionProvider {
  getVersion(): Promise<string | null>
}

export interface ServerTimeGateway {
  getServerTime(): Promise<Date | null>
}

export interface PassiveScannerHealthProbe {
  probe(mode: DeviceHealthMode): Promise<readonly DeviceHealthCheck[]>
}
