import type { DeviceHealthCheck, DeviceHealthMode, PassiveScannerHealthProbe } from '../domain/device-health/contracts'
import { getPlatformAdapter } from '../platform/runtime-platform'

/** Passive capability inspection only: it never scans, requests permission, or installs a module. */
export class CapacitorScannerHealthProbe implements PassiveScannerHealthProbe {
  public async probe(mode: DeviceHealthMode): Promise<readonly DeviceHealthCheck[]> { return getPlatformAdapter().scanner.healthProbe().probe(mode) }
}
