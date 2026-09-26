import type { ActiveCountingContext } from '../../domain/count/save-physical-count'
import type { DeviceHealthMode, DeviceHealthReport } from '../../domain/device-health/contracts'

export interface DeviceHealthChecker { check(): Promise<DeviceHealthReport> }

/**
 * App composition consumes exactly the context resolved during Health. It must
 * never resolve authorization a second time just to create capture runtime.
 */
export async function runDeviceHealthCheck<Runtime>(mode: DeviceHealthMode, dependencies: {
  createService: (mode: DeviceHealthMode) => DeviceHealthChecker
  createCountingRuntime: (context: ActiveCountingContext) => Runtime
}): Promise<{ report: DeviceHealthReport; runtime: Runtime | null }> {
  const report = await dependencies.createService(mode).check()
  const context = report.resolvedContext
  return {
    report,
    runtime: context.kind === 'ONLINE' || context.kind === 'OFFLINE' ? dependencies.createCountingRuntime(context.context) : null,
  }
}
