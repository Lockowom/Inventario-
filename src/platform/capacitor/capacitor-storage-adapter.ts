import type { LocalHealthProbe } from '../../domain/device-health/contracts'
import type { CountRepository } from '../../domain/ports/count-repository'
import type { CountingContextRepository } from '../../domain/ports/counting-context-repository'
import type { MasterSkuRepository } from '../../domain/ports/master-sku-repository'
import { CapacitorSqliteDatabase } from './capacitor-sqlite-database'
import { SqliteCountRepository } from '../../storage/mobile-sqlite/sqlite-count-repository'
import { SqliteCountingContextRepository } from '../../storage/mobile-sqlite/sqlite-counting-context-repository'
import { SqliteLocalHealthProbe } from '../../storage/mobile-sqlite/sqlite-local-health-probe'
import { SqliteMasterSkuRepository } from '../../storage/mobile-sqlite/sqlite-master-sku-repository'
import type { StorageAdapter } from '../contracts'

/** Existing Android/iOS SQLite implementation, now hidden behind StorageAdapter. */
export class CapacitorStorageAdapter implements StorageAdapter {
  private database: CapacitorSqliteDatabase | undefined

  private getDatabase(): CapacitorSqliteDatabase {
    this.database ??= new CapacitorSqliteDatabase('inven3')
    return this.database
  }

  public countingContextRepository(): CountingContextRepository { return new SqliteCountingContextRepository(this.getDatabase()) }
  public countRepository(): CountRepository { return new SqliteCountRepository(this.getDatabase()) }
  public masterSkuRepository(): MasterSkuRepository { return new SqliteMasterSkuRepository(this.getDatabase()) }
  public localHealthProbe(): LocalHealthProbe { return new SqliteLocalHealthProbe(this.getDatabase()) }
}
