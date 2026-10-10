import type { LocalCountRecord } from '../count/contracts'
import type { CountRepository } from '../ports/count-repository'
import { SYNC_BATCH_SIZE, syncRpcResultSchema, type LocalSyncAcknowledgement, type SyncRpcResult, type SyncRunSummary } from './contracts'
import { nextRetryAt } from './retry-policy'
import { asFailClosedSyncError, SyncTransportError } from './transport-error'

export interface CountSyncGateway {
  registerDevice(input: { deviceId: string }): Promise<void>
  reportPending(input: { inventoryId: string; deviceId: string; pendingCount: number }): Promise<void>
  syncBatch(input: { inventoryId: string; deviceId: string; records: LocalCountRecord[] }): Promise<unknown>
}

export interface SyncManagerContext { inventoryId: string; userId: string }
export interface SyncRunOptions { forceRetry?: boolean }

/**
 * Coordinates a local outbox. It has no SQL/Dexie/Supabase dependency: adapters
 * are injected, allowing the domain to remain offline-first and testable.
 */
export class SyncManager {
  private inFlight: Promise<SyncRunSummary> | null = null

  public constructor(
    private readonly context: SyncManagerContext,
    private readonly counts: CountRepository,
    private readonly gateway: CountSyncGateway | null,
    private readonly clock: () => Date = () => new Date(),
    private readonly random: () => number = Math.random,
  ) {}

  public run(options: SyncRunOptions = {}): Promise<SyncRunSummary> {
    this.inFlight ??= this.runInternal(options).finally(() => { this.inFlight = null })
    return this.inFlight
  }

  /** Best-effort guard reporting never changes a saved local count on failure. */
  public async announcePending(): Promise<void> {
    if (!this.gateway) return
    const deviceId = await this.counts.getOrCreateDeviceId(this.context.userId)
    await this.gateway.registerDevice({ deviceId })
    await this.gateway.reportPending({ inventoryId: this.context.inventoryId, deviceId, pendingCount: await this.counts.countOutstandingByInventoryDevice(this.context.inventoryId, deviceId) })
  }

  private async runInternal(options: SyncRunOptions): Promise<SyncRunSummary> {
    const summary: SyncRunSummary = { claimed: 0, confirmed: 0, rejected: 0, failed: 0, conflicts: 0, diagnostic: null }
    if (!this.gateway) return summary
    const deviceId = await this.counts.getOrCreateDeviceId(this.context.userId)
    const now = this.clock()
    await this.counts.recoverStaleSyncing({ inventoryId: this.context.inventoryId, userId: this.context.userId, before: new Date(now.getTime() - 10 * 60_000).toISOString(), now: now.toISOString() })

    try { await this.gateway.registerDevice({ deviceId }) } catch (error: unknown) {
      summary.diagnostic = asFailClosedSyncError(error).code
      return summary
    }
    while (true) {
      const claimedAt = this.clock()
      const claimed = await this.counts.claimNextSyncBatch({ inventoryId: this.context.inventoryId, userId: this.context.userId, max: SYNC_BATCH_SIZE, now: claimedAt.toISOString(), forceRetry: options.forceRetry })
      if (claimed.length === 0) break
      summary.claimed += claimed.length
      try {
        const raw = await this.gateway.syncBatch({ inventoryId: this.context.inventoryId, deviceId, records: claimed })
        const results = parseBatchResponse(raw, claimed)
        const acknowledged: LocalSyncAcknowledgement[] = []
        for (const result of results) {
          if (result.result_status === 'ACCEPTED' || result.result_status === 'ALREADY_ACCEPTED') {
            acknowledged.push({ clientCountId: result.client_count_id, syncStatus: 'CONFIRMED', serverCountId: result.server_count_id, receivedAt: result.received_at, reason: null })
            summary.confirmed += 1
          } else {
            acknowledged.push({ clientCountId: result.client_count_id, syncStatus: 'REJECTED', serverCountId: null, receivedAt: null, reason: result.reason ?? (result.result_status === 'CONFLICT' ? 'CLIENT_COUNT_ID_PAYLOAD_CONFLICT' : 'REJECTED_BY_SERVER') })
            summary.rejected += 1
            if (result.result_status === 'CONFLICT') summary.conflicts += 1
          }
        }
        await this.counts.applySyncAcknowledgements(acknowledged, this.clock().toISOString())
        const acknowledgedIds = new Set(acknowledged.map((item) => item.clientCountId))
        const missing = claimed.filter((record) => !acknowledgedIds.has(record.clientCountId))
        if (missing.length) {
          await this.markTerminalForReview(missing, 'SYNC_RESPONSE_INCOMPLETE')
          summary.rejected += missing.length
          summary.diagnostic = 'SYNC_RESPONSE_INCOMPLETE'
          break
        }
      } catch (error: unknown) {
        const transport = asFailClosedSyncError(error)
        summary.diagnostic = transport.code
        if (transport.retryable) {
          await this.failClaimed(claimed, transport.code)
          summary.failed += claimed.length
        } else {
          await this.markTerminalForReview(claimed, transport.code)
          summary.rejected += claimed.length
        }
        break
      }
    }
    try {
      await this.gateway.reportPending({ inventoryId: this.context.inventoryId, deviceId, pendingCount: await this.counts.countOutstandingByInventoryDevice(this.context.inventoryId, deviceId) })
    } catch (error: unknown) {
      // The report is best effort: it never changes the durable outbox state.
      summary.diagnostic ??= asFailClosedSyncError(error).code
    }
    return summary
  }

  private async failClaimed(records: LocalCountRecord[], error: string): Promise<void> {
    const now = this.clock()
    const highestAttempt = Math.max(...records.map((record) => record.syncAttempts + 1))
    await this.counts.markSyncFailed({ clientCountIds: records.map((record) => record.clientCountId), error, nextRetryAt: nextRetryAt(highestAttempt, now, this.random), now: now.toISOString() })
  }

  private async markTerminalForReview(records: LocalCountRecord[], reason: string): Promise<void> {
    await this.counts.applySyncAcknowledgements(records.map((record) => ({
      clientCountId: record.clientCountId, syncStatus: 'REJECTED', serverCountId: null, receivedAt: null, reason,
    })), this.clock().toISOString())
  }
}

function parseBatchResponse(raw: unknown, claimed: LocalCountRecord[]): SyncRpcResult[] {
  if (!Array.isArray(raw)) throw new SyncTransportError('TERMINAL_CONTRACT', 'SYNC_RESPONSE_INCOMPATIBLE')
  const allowed = new Set(claimed.map((record) => record.clientCountId))
  const ids = new Set<string>()
  return raw.map((item) => {
    const result = syncRpcResultSchema.safeParse(item)
    if (!result.success) throw new SyncTransportError('TERMINAL_CONTRACT', 'SYNC_RESPONSE_INCOMPATIBLE')
    const parsed = result.data
    if (!allowed.has(parsed.client_count_id) || ids.has(parsed.client_count_id)) throw new SyncTransportError('TERMINAL_CONTRACT', 'SYNC_RESPONSE_INCOMPATIBLE')
    if ((parsed.result_status === 'ACCEPTED' || parsed.result_status === 'ALREADY_ACCEPTED') && (!parsed.server_count_id || !parsed.received_at)) throw new SyncTransportError('TERMINAL_CONTRACT', 'SYNC_RESPONSE_INCOMPATIBLE')
    ids.add(parsed.client_count_id)
    return parsed
  })
}
