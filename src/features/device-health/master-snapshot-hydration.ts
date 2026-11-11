import type { MasterSkuRepository } from '../../domain/ports/master-sku-repository'

const hydrationInFlight = new Map<string, Promise<void>>()
const MASTER_SYNC_TIMEOUT_MS = 15_000

function diagnostic(stage: string, fields: Record<string, string | number> = {}) {
  if (import.meta.env.MODE !== 'qa' && !import.meta.env.DEV) return
  console.info(`INVEN3_MASTER ${stage} ${Object.entries(fields).map(([key, value]) => `${key}=${value}`).join(' ')}`.trim())
}

function withTimeout<T>(operation: Promise<T>, stage: string): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    const timeout = globalThis.setTimeout(() => reject(new Error(`${stage}_TIMEOUT`)), MASTER_SYNC_TIMEOUT_MS)
    operation.then(resolve, reject).finally(() => globalThis.clearTimeout(timeout))
  })
}

/**
 * Keeps the durable local master aligned with the server-authoritative snapshot
 * while the device is online. Capture continues to consume only the local
 * repository, so offline behavior remains deterministic.
 */
export async function hydrateLocalMasterSnapshot(
  inventoryId: string,
  local: MasterSkuRepository,
  remote: MasterSkuRepository,
): Promise<void> {
  const current = hydrationInFlight.get(inventoryId)
  if (current) return current
  const hydration = hydrate(inventoryId, local, remote).finally(() => hydrationInFlight.delete(inventoryId))
  hydrationInFlight.set(inventoryId, hydration)
  return hydration
}

async function hydrate(inventoryId: string, local: MasterSkuRepository, remote: MasterSkuRepository): Promise<void> {
  diagnostic('MASTER_HYDRATE_START', { inventory_id: inventoryId })
  try {
    diagnostic('MASTER_METADATA_FETCH_START', { inventory_id: inventoryId })
    const remoteMetadata = await withTimeout(remote.getMetadata(inventoryId), 'MASTER_METADATA_FETCH')
    if (!remoteMetadata) throw new Error('MASTER_METADATA_FETCH_FAIL')
    diagnostic('MASTER_METADATA_FETCH_OK', { inventory_id: inventoryId, version: remoteMetadata.masterVersion, row_count: remoteMetadata.rowCount })

    const localMetadata = await withTimeout(local.getMetadata(inventoryId), 'MASTER_SQLITE_VERIFY')
    const localItems = localMetadata ? await withTimeout(local.listByInventory(inventoryId), 'MASTER_SQLITE_VERIFY') : []
    if (localMetadata?.masterVersion === remoteMetadata.masterVersion && localMetadata.rowCount === remoteMetadata.rowCount && localMetadata.fingerprint.toLowerCase() === remoteMetadata.fingerprint.toLowerCase() && localItems.length === remoteMetadata.rowCount) {
      diagnostic('MASTER_SQLITE_VERIFY_OK', { inventory_id: inventoryId, rows: localItems.length })
      diagnostic('MASTER_CACHE_HIT', { inventory_id: inventoryId, version: remoteMetadata.masterVersion, rows: localItems.length })
      diagnostic('MASTER_HYDRATE_COMPLETE', { inventory_id: inventoryId, rows: localItems.length })
      return
    }

    diagnostic('MASTER_ITEMS_FETCH_START', { inventory_id: inventoryId })
    const items = await withTimeout(remote.listByInventory(inventoryId), 'MASTER_ITEMS_FETCH')
    if (items.length !== remoteMetadata.rowCount || items.some((item) => item.inventoryId !== inventoryId)) throw new Error('MASTER_ITEMS_FETCH_FAIL')
    diagnostic('MASTER_ITEMS_FETCH_OK', { inventory_id: inventoryId, rows: items.length })
    diagnostic('MASTER_SQLITE_WRITE_START', { inventory_id: inventoryId, rows: items.length })
    await withTimeout(local.replaceSnapshot({ metadata: remoteMetadata, items }), 'MASTER_SQLITE_WRITE')
    diagnostic('MASTER_SQLITE_WRITE_OK', { inventory_id: inventoryId, rows: items.length })
    diagnostic('MASTER_SQLITE_VERIFY_START', { inventory_id: inventoryId })
    const verified = await withTimeout(local.listByInventory(inventoryId), 'MASTER_SQLITE_VERIFY')
    if (verified.length !== remoteMetadata.rowCount) throw new Error('MASTER_SQLITE_VERIFY_FAIL')
    diagnostic('MASTER_SQLITE_VERIFY_OK', { inventory_id: inventoryId, rows: verified.length })
    diagnostic('MASTER_HYDRATE_COMPLETE', { inventory_id: inventoryId, rows: verified.length })
  } catch (error) {
    diagnostic('MASTER_HYDRATE_FAIL', { inventory_id: inventoryId, reason: error instanceof Error ? error.message.replace(/[^A-Z_]/g, '') || 'UNKNOWN' : 'UNKNOWN' })
    throw error
  }
}
