import { DeviceHealthService } from '../../domain/device-health/device-health-service'
import type { DeviceHealthMode } from '../../domain/device-health/contracts'
import { resolveCountingContext } from '../../domain/count/resolve-counting-context'
import { verifyServerCountingContext } from '../counting/authorized-counting-context'
import { getCountingContextRepository, getLocalHealthProbe, getMasterSkuRepository } from '../counting/counting-runtime'
import { CapacitorAppVersionProvider } from '../../services/app-version-provider'
import { SupabaseServerTimeGateway } from '../../services/supabase-server-time-gateway'
import { CapacitorScannerHealthProbe } from '../../scanner/scanner-health-probe'
import { SupabaseMasterSkuRepository } from '../../services/supabase-master-sku-repository'
import { hydrateLocalMasterSnapshot } from './master-snapshot-hydration'

/** Infrastructure composition for F9A.4A. No screen or capture gating consumes it yet. */
export function createDeviceHealthService(mode: DeviceHealthMode): DeviceHealthService {
  const cache = getCountingContextRepository()
  const masters = getMasterSkuRepository()
  const remoteMasters = new SupabaseMasterSkuRepository()
  return new DeviceHealthService({
    mode,
    resolveContext: () => resolveCountingContext({ verifyServer: verifyServerCountingContext }, cache),
    masters,
    hydrateMasterSnapshot: async (inventoryId) => {
      try {
        await hydrateLocalMasterSnapshot(inventoryId, masters, remoteMasters)
      } catch (error: unknown) {
        console.error('MASTER_SNAPSHOT_HYDRATION_FAIL', error)
        throw error
      }
    },
    localHealth: getLocalHealthProbe(),
    appVersion: new CapacitorAppVersionProvider(),
    serverTime: new SupabaseServerTimeGateway(),
    scanner: new CapacitorScannerHealthProbe(),
  })
}
