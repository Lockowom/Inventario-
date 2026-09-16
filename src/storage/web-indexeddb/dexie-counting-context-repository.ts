import { cachedCountingContextSchema, type CachedCountingContext, type CountingContextRepository } from '../../domain/ports/counting-context-repository'
import { Inven3WebDatabase } from './inven3-web-database'

export class DexieCountingContextRepository implements CountingContextRepository {
  public constructor(private readonly database: Inven3WebDatabase) {}
  public async get(): Promise<CachedCountingContext | null> {
    const row = await this.database.countingContext.get('active')
    return row ? cachedCountingContextSchema.parse(row) : null
  }
  public async save(context: CachedCountingContext): Promise<void> {
    const valid = cachedCountingContextSchema.parse(context)
    await this.database.countingContext.put({ key: 'active', ...valid })
  }
  public async clear(): Promise<void> { await this.database.countingContext.delete('active') }
}
