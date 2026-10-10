import type { CountRepository } from '../ports/count-repository'
import type { SyncRunSummary } from './contracts'
import { SyncManager, type CountSyncGateway, type SyncRunOptions } from './sync-manager'

export interface SyncCoordinatorSummary extends SyncRunSummary { scopes: number; diagnostic: string | null }

/**
 * App-level outbox coordinator. It discovers durable work independently from
 * CaptureRuntime, and shares a worker for every user+inventory scope.
 */
export class SyncCoordinator {
  private readonly active = new Map<string, ActiveScope>()

  public constructor(private readonly userId: string, private readonly counts: CountRepository, private readonly gateway: CountSyncGateway | null) {}

  public async discoverOutstandingScopes() { return this.counts.listOutstandingSyncScopes(this.userId) }

  public runInventorySync(inventoryId: string, options: SyncRunOptions = {}): Promise<SyncRunSummary> {
    const key = `${this.userId}:${inventoryId}`
    const existing = this.active.get(key)
    if (existing) {
      // A count can be persisted while the current batch is on the wire.  Do
      // not start a competing worker, but do guarantee one pass after it.
      existing.needsRerun = true
      existing.forceRetry = existing.forceRetry || options.forceRetry === true
      return existing.promise
    }
    const scope: ActiveScope = { promise: Promise.resolve(emptySummary()), needsRerun: false, forceRetry: options.forceRetry === true }
    scope.promise = this.runScopeLoop(key, inventoryId, scope)
    this.active.set(key, scope)
    return scope.promise
  }

  private async runScopeLoop(key: string, inventoryId: string, scope: ActiveScope): Promise<SyncRunSummary> {
    let total = emptySummary()
    try {
      do {
        const forceRetry = scope.forceRetry
        scope.forceRetry = false
        scope.needsRerun = false
        const current = await new SyncManager({ inventoryId, userId: this.userId }, this.counts, this.gateway).run({ forceRetry })
        total = addSummaries(total, current)
      } while (scope.needsRerun)
      return total
    } finally {
      this.active.delete(key)
    }
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

type ActiveScope = {
  promise: Promise<SyncRunSummary>
  needsRerun: boolean
  forceRetry: boolean
}

function emptySummary(): SyncRunSummary {
  return { claimed: 0, confirmed: 0, rejected: 0, failed: 0, conflicts: 0, diagnostic: null }
}

function addSummaries(total: SyncRunSummary, current: SyncRunSummary): SyncRunSummary {
  return {
    claimed: total.claimed + current.claimed,
    confirmed: total.confirmed + current.confirmed,
    rejected: total.rejected + current.rejected,
    failed: total.failed + current.failed,
    conflicts: total.conflicts + current.conflicts,
    diagnostic: total.diagnostic ?? current.diagnostic,
  }
}
