import type { CountRepository } from '../ports/count-repository'
import type { SyncRunSummary } from './contracts'
import { SyncManager, type CountSyncGateway, type SyncRunOptions } from './sync-manager'

export interface SyncCoordinatorSummary extends SyncRunSummary { scopes: number; diagnostic: string | null }

/**
 * App-level outbox coordinator. It discovers durable work independently from
 * CaptureRuntime, and shares a worker for every user+inventory scope.
 */
export class SyncCoordinator {
  private readonly active = new Map<string, Promise<SyncRunSummary>>()

  public constructor(private readonly userId: string, private readonly counts: CountRepository, private readonly gateway: CountSyncGateway | null) {}

  public async discoverOutstandingScopes() { return this.counts.listOutstandingSyncScopes(this.userId) }

  public runInventorySync(inventoryId: string, options: SyncRunOptions = {}): Promise<SyncRunSummary> {
    const key = `${this.userId}:${inventoryId}`
    const existing = this.active.get(key)
    if (existing) {
      if (!options.forceRetry) return existing
      return existing.then(() => this.runInventorySync(inventoryId, options))
    }
    const run = new SyncManager({ inventoryId, userId: this.userId }, this.counts, this.gateway).run(options)
      .finally(() => { this.active.delete(key) })
    this.active.set(key, run)
    return run
  }

  public async runOutstanding(options: SyncRunOptions = {}): Promise<SyncCoordinatorSummary> {
    const scopes = await this.discoverOutstandingScopes()
    const summaries = await Promise.all(scopes.map((scope) => this.runInventorySync(scope.inventoryId, options)))
    return summaries.reduce<SyncCoordinatorSummary>((total, current) => ({
      scopes: total.scopes + 1,
      claimed: total.claimed + current.claimed,
      confirmed: total.confirmed + current.confirmed,
      rejected: total.rejected + current.rejected,
      failed: total.failed + current.failed,
      conflicts: total.conflicts + current.conflicts,
      diagnostic: total.diagnostic ?? current.diagnostic,
    }), { scopes: 0, claimed: 0, confirmed: 0, rejected: 0, failed: 0, conflicts: 0, diagnostic: null })
  }
}
