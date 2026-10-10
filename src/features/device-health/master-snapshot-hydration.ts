import type { MasterSkuRepository } from '../../domain/ports/master-sku-repository'

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
  const remoteMetadata = await remote.getMetadata(inventoryId)
  if (!remoteMetadata) throw new Error('Remote master metadata is unavailable.')

  const localMetadata = await local.getMetadata(inventoryId)
  if (
    localMetadata?.masterVersion === remoteMetadata.masterVersion
    && localMetadata.rowCount === remoteMetadata.rowCount
    && localMetadata.fingerprint.toLowerCase() === remoteMetadata.fingerprint.toLowerCase()
  ) return

  const items = await remote.listByInventory(inventoryId)
  if (items.length !== remoteMetadata.rowCount) throw new Error('Remote master snapshot is incomplete.')
  await local.replaceSnapshot({ metadata: remoteMetadata, items })
}
