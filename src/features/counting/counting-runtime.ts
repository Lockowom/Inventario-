import type { ActiveCountingContext } from '../../domain/count/save-physical-count'
import type { CountingContextRepository } from '../../domain/ports/counting-context-repository'
import type { CountingRuntime } from './counting-screen'
import type { CountRepository } from '../../domain/ports/count-repository'
import type { MasterSkuRepository } from '../../domain/ports/master-sku-repository'
import type { LocalHealthProbe } from '../../domain/device-health/contracts'
import { SyncCoordinator } from '../../domain/sync/sync-coordinator'
import { SupabaseSyncGateway } from '../../services/supabase-sync-gateway'
import { isSupabaseConfigured } from '../../services/supabase'
import { getPlatformAdapter } from '../../platform/runtime-platform'

/**
 * Infrastructure composition only. Auth/inventory selection must supply the
 * already-authorized ABIERTO context; this factory does not fetch or invent it.
 */
export function getCountingContextRepository(): CountingContextRepository {
  return getPlatformAdapter().storage.countingContextRepository()
}

/** Shared durable outbox repository, available even when capture is unavailable. */
export function getCountRepository(): CountRepository {
  return getPlatformAdapter().storage.countRepository()
}

/** Reuses the same local database singleton as capture and sync. */
export function getMasterSkuRepository(): MasterSkuRepository {
  return getPlatformAdapter().storage.masterSkuRepository()
}

/** Technical probe composition only; it does not alter count runtime behavior. */
export function getLocalHealthProbe(): LocalHealthProbe {
  return getPlatformAdapter().storage.localHealthProbe()
}

/** App composition for sync; it has no dependency on an ABIERTO CaptureRuntime. */
export function createSyncCoordinator(userId: string): SyncCoordinator {
  return new SyncCoordinator(userId, getCountRepository(), isSupabaseConfigured ? new SupabaseSyncGateway() : null)
}

export function createCountingRuntime(context: ActiveCountingContext): CountingRuntime {
  return { context, masters: getMasterSkuRepository(), counts: getCountRepository() }
}
