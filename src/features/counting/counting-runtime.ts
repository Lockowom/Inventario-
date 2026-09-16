import { Capacitor } from '@capacitor/core'
import type { ActiveCountingContext } from '../../domain/count/save-physical-count'
import { SqliteMasterSkuRepository } from '../../storage/mobile-sqlite/sqlite-master-sku-repository'
import { CapacitorSqliteDatabase } from '../../storage/mobile-sqlite/capacitor-sqlite-database'
import { SqliteCountRepository } from '../../storage/mobile-sqlite/sqlite-count-repository'
import { DexieMasterSkuRepository } from '../../storage/web-indexeddb/dexie-master-sku-repository'
import { DexieCountRepository } from '../../storage/web-indexeddb/dexie-count-repository'
import { Inven3WebDatabase } from '../../storage/web-indexeddb/inven3-web-database'
import type { CountingRuntime } from './counting-screen'

/**
 * Infrastructure composition only. Auth/inventory selection must supply the
 * already-authorized ABIERTO context; this factory does not fetch or invent it.
 */
export function createCountingRuntime(context: ActiveCountingContext): CountingRuntime {
  if (Capacitor.getPlatform() === 'web') {
    const database = new Inven3WebDatabase()
    return { context, masters: new DexieMasterSkuRepository(database), counts: new DexieCountRepository(database) }
  }
  const database = new CapacitorSqliteDatabase('inven3')
  return { context, masters: new SqliteMasterSkuRepository(database), counts: new SqliteCountRepository(database) }
}
