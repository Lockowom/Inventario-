import { createMasterFingerprint, masterMetadataSchema, masterSkuSchema, type MasterMetadata } from './contracts'
import type { MasterSkuRepository, MasterSnapshot } from '../ports/master-sku-repository'

export async function refreshMasterSnapshot(inventoryId: string, remote: MasterSkuRepository, local: MasterSkuRepository): Promise<MasterMetadata> {
  const metadata = await remote.getMetadata(inventoryId)
  if (!metadata) throw new Error('El inventario no tiene un maestro disponible.')
  const initialMetadata = masterMetadataSchema.parse(metadata)
  const items = (await remote.listByInventory(inventoryId)).map((item) => masterSkuSchema.parse(item))
  if (items.length !== initialMetadata.rowCount || await createMasterFingerprint(items) !== initialMetadata.fingerprint.toLowerCase()) throw new Error('El maestro remoto no coincide con su metadata.')
  const finalMetadata = await remote.getMetadata(inventoryId)
  const verifiedFinalMetadata = finalMetadata ? masterMetadataSchema.parse(finalMetadata) : null
  if (!verifiedFinalMetadata || verifiedFinalMetadata.masterVersion !== initialMetadata.masterVersion || verifiedFinalMetadata.rowCount !== initialMetadata.rowCount || verifiedFinalMetadata.fingerprint.toLowerCase() !== initialMetadata.fingerprint.toLowerCase()) throw new Error('El maestro cambió durante la descarga. Intente actualizar nuevamente.')
  const snapshot: MasterSnapshot = { items, metadata: initialMetadata }
  await local.replaceSnapshot(snapshot)
  return snapshot.metadata
}

export async function isLocalMasterCurrent(inventoryId: string, remote: MasterSkuRepository, local: MasterSkuRepository): Promise<boolean> {
  const [remoteMetadata, localMetadata] = await Promise.all([remote.getMetadata(inventoryId), local.getMetadata(inventoryId)])
  return Boolean(remoteMetadata && localMetadata && remoteMetadata.masterVersion === localMetadata.masterVersion && remoteMetadata.fingerprint === localMetadata.fingerprint)
}
