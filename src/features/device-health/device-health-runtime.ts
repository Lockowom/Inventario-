import { DeviceHealthService } from '../../domain/device-health/device-health-service'
import type { DeviceHealthMode } from '../../domain/device-health/contracts'
import { resolveCountingContext } from '../../domain/count/resolve-counting-context'
import { getLocalSessionUserId, verifyServerCountingContext } from '../counting/authorized-counting-context'
import { getCountingContextRepository, getLocalHealthProbe, getMasterSkuRepository } from '../counting/counting-runtime'
import { CapacitorAppVersionProvider } from '../../services/app-version-provider'
import { SupabaseServerTimeGateway } from '../../services/supabase-server-time-gateway'
import { CapacitorScannerHealthProbe } from '../../scanner/scanner-health-probe'

/** Infrastructure composition for F9A.4A. No screen or capture gating consumes it yet. */
export function createDeviceHealthService(mode: DeviceHealthMode): DeviceHealthService {
  const cache = getCountingContextRepository()
  return new DeviceHealthService({
    mode,
    resolveContext: () => resolveCountingContext({ verifyServer: verifyServerCountingContext, getLocalSessionUserId }, cache),
    getLocalSessionUserId,
    masters: getMasterSkuRepository(),
    localHealth: getLocalHealthProbe(),
    appVersion: new CapacitorAppVersionProvider(),
    serverTime: new SupabaseServerTimeGateway(),
    scanner: new CapacitorScannerHealthProbe(),
  })
}
