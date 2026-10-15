import { cachedCountingContextSchema, type CachedCountingContext, type CountingContextRepository } from '../../domain/ports/counting-context-repository'
import type { SqliteDatabase } from './sqlite-database'
import { applySqliteMigrations } from './sqlite-migrations'

interface ContextRow extends Record<string, unknown> { user_id: string; inventory_id: string; inventory_status: 'ABIERTO'; verified_at: string; role: 'CONTADOR' | 'ANALISTA' | 'ADMIN' | null }

export class SqliteCountingContextRepository implements CountingContextRepository {
  private initialized = false
  public constructor(private readonly database: SqliteDatabase) {}

  public async get(): Promise<CachedCountingContext | null> {
    await this.initialize()
    const row = (await this.database.query<ContextRow>("select user_id, inventory_id, inventory_status, verified_at, role from local_counting_context where context_key = 'active'")).values[0]
    return row ? cachedCountingContextSchema.parse({ userId: row.user_id, inventoryId: row.inventory_id, inventoryStatus: row.inventory_status, verifiedAt: row.verified_at, role: row.role ?? undefined }) : null
  }
  public async save(context: CachedCountingContext): Promise<void> {
    await this.initialize()
    const valid = cachedCountingContextSchema.parse(context)
    await this.database.transaction(async () => {
      await this.database.execute("delete from local_counting_context where context_key = 'active'")
      await this.database.execute("insert into local_counting_context (context_key, user_id, inventory_id, inventory_status, verified_at, role) values ('active', ?, ?, ?, ?, ?)", [valid.userId, valid.inventoryId, valid.inventoryStatus, valid.verifiedAt, valid.role ?? null])
    })
  }
  public async clear(): Promise<void> {
    await this.initialize()
    await this.database.transaction(async () => {
      await this.database.execute("delete from local_counting_context where context_key = 'active'")
    })
  }
  private async initialize(): Promise<void> { if (this.initialized) return; await this.database.initialize(); await applySqliteMigrations(this.database); this.initialized = true }
}
