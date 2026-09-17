import { Capacitor } from '@capacitor/core'
import type { ActiveCountingContext } from '../../domain/count/save-physical-count'
import { SqliteMasterSkuRepository } from '../../storage/mobile-sqlite/sqlite-master-sku-repository'
import { CapacitorSqliteDatabase } from '../../storage/mobile-sqlite/capacitor-sqlite-database'
import { SqliteCountRepository } from '../../storage/mobile-sqlite/sqlite-count-repository'
import { DexieMasterSkuRepository } from '../../storage/web-indexeddb/dexie-master-sku-repository'
import { DexieCountRepository } from '../../storage/web-indexeddb/dexie-count-repository'
import { Inven3WebDatabase } from '../../storage/web-indexeddb/inven3-web-database'
import { SqliteCountingContextRepository } from '../../storage/mobile-sqlite/sqlite-counting-context-repository'
import { DexieCountingContextRepository } from '../../storage/web-indexeddb/dexie-counting-context-repository'
import type { CountingContextRepository } from '../../domain/ports/counting-context-repository'
import type { CountingRuntime } from './counting-screen'
import { SyncManager } from '../../domain/sync/sync-manager'
import { SupabaseSyncGateway } from '../../services/supabase-sync-gateway'
import { isSupabaseConfigured } from '../../services/supabase'

/**
 * Infrastructure composition only. Auth/inventory selection must supply the
 * already-authorized ABIERTO context; this factory does not fetch or invent it.
 */
let webDatabase: Inven3WebDatabase | undefined
let mobileDatabase: CapacitorSqliteDatabase | undefined

function getWebDatabase(): Inven3WebDatabase { webDatabase ??= new Inven3WebDatabase(); return webDatabase }
function getMobileDatabase(): CapacitorSqliteDatabase { mobileDatabase ??= new CapacitorSqliteDatabase('inven3'); return mobileDatabase }

export function getCountingContextRepository(): CountingContextRepository {
  return Capacitor.getPlatform() === 'web' ? new DexieCountingContextRepository(getWebDatabase()) : new SqliteCountingContextRepository(getMobileDatabase())
}

export function createCountingRuntime(context: ActiveCountingContext): CountingRuntime {
  if (Capacitor.getPlatform() === 'web') {
    const database = getWebDatabase()
    const counts = new DexieCountRepository(database)
    return { context, masters: new DexieMasterSkuRepository(database), counts, sync: new SyncManager(context, counts, isSupabaseConfigured ? new SupabaseSyncGateway() : null) }
  }
  const database = getMobileDatabase()
  const counts = new SqliteCountRepository(database)
  return { context, masters: new SqliteMasterSkuRepository(database), counts, sync: new SyncManager(context, counts, isSupabaseConfigured ? new SupabaseSyncGateway() : null) }
}
