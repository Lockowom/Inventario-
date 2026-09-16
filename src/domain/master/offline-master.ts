import { masterMetadataSchema, masterSkuSchema, type MasterMetadata } from './contracts'
import type { MasterSkuRepository, MasterSnapshot } from '../ports/master-sku-repository'

export async function refreshMasterSnapshot(inventoryId: string, remote: MasterSkuRepository, local: MasterSkuRepository): Promise<MasterMetadata> {
  const metadata = await remote.getMetadata(inventoryId)
  if (!metadata) throw new Error('El inventario no tiene un maestro disponible.')
  const items = (await remote.listByInventory(inventoryId)).map((item) => masterSkuSchema.parse(item))
  if (items.length !== metadata.rowCount) throw new Error('El maestro remoto no coincide con su metadata.')
  const snapshot: MasterSnapshot = { items, metadata: masterMetadataSchema.parse(metadata) }
  await local.replaceSnapshot(snapshot)
  return snapshot.metadata
}

export async function isLocalMasterCurrent(inventoryId: string, remote: MasterSkuRepository, local: MasterSkuRepository): Promise<boolean> {
  const [remoteMetadata, localMetadata] = await Promise.all([remote.getMetadata(inventoryId), local.getMetadata(inventoryId)])
  return Boolean(remoteMetadata && localMetadata && remoteMetadata.masterVersion === localMetadata.masterVersion && remoteMetadata.fingerprint === localMetadata.fingerprint)
}
