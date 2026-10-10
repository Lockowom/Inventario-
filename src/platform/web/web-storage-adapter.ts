import type { LocalHealthProbe } from '../../domain/device-health/contracts'
import type { CountRepository } from '../../domain/ports/count-repository'
import type { CountingContextRepository } from '../../domain/ports/counting-context-repository'
import type { MasterSkuRepository } from '../../domain/ports/master-sku-repository'
import { DexieCountRepository } from '../../storage/web-indexeddb/dexie-count-repository'
import { DexieCountingContextRepository } from '../../storage/web-indexeddb/dexie-counting-context-repository'
import { DexieLocalHealthProbe } from '../../storage/web-indexeddb/dexie-local-health-probe'
import { DexieMasterSkuRepository } from '../../storage/web-indexeddb/dexie-master-sku-repository'
import { Inven3WebDatabase } from '../../storage/web-indexeddb/inven3-web-database'
import type { StorageAdapter } from '../contracts'

/** Web is the safe fallback until the dedicated Tauri SQLite adapter exists in WIN-06. */
export class WebStorageAdapter implements StorageAdapter {
  private database: Inven3WebDatabase | undefined

  private getDatabase(): Inven3WebDatabase {
    this.database ??= new Inven3WebDatabase()
    return this.database
  }

  public countingContextRepository(): CountingContextRepository { return new DexieCountingContextRepository(this.getDatabase()) }
  public countRepository(): CountRepository { return new DexieCountRepository(this.getDatabase()) }
  public masterSkuRepository(): MasterSkuRepository { return new DexieMasterSkuRepository(this.getDatabase()) }
  public localHealthProbe(): LocalHealthProbe { return new DexieLocalHealthProbe(this.getDatabase()) }
}
