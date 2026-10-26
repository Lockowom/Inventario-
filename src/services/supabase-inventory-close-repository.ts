import { inventoryCloseReadinessSchema, inventoryCloseResultSchema, type InventoryClosePreview, type InventoryCloseResult } from '../domain/inventory-close/contracts'
import { getSupabaseClient } from './supabase'

function clientOrThrow() {
  const client = getSupabaseClient()
  if (!client) throw new Error('Cierre final de inventario no configurado.')
  return client
}

export class SupabaseInventoryCloseRepository {
  async previewInventoryClose(inventoryId: string): Promise<InventoryClosePreview> {
    const { data, error } = await clientOrThrow().rpc('preview_inventory_close', { p_inventory_id: inventoryId })
    if (error) throw new Error(error.message)
    return inventoryCloseReadinessSchema.parse(data)
  }

  async closeInventoryFinal(inventoryId: string, expectedFingerprint: string, requestId = crypto.randomUUID()): Promise<InventoryCloseResult> {
    const { data, error } = await clientOrThrow().rpc('close_inventory_final', {
      p_inventory_id: inventoryId,
      p_expected_fingerprint: expectedFingerprint,
      p_request_id: requestId,
    })
    if (error) throw new Error(error.message)
    return inventoryCloseResultSchema.parse(data)
  }
}
