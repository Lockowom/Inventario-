import { getSupabaseClient } from './supabase'
import { generateRpReleaseXlsx, rpReleaseFilename, validateRpReleaseXlsx, type RpReleaseExport } from '../domain/rp-release/rp-release-xlsx'

function client() { const value = getSupabaseClient(); if (!value) throw new Error('RP no configurado.') ; return value }
export class SupabaseRpReleaseRepository {
  async warehouse(inventoryId: string) { const { data, error } = await client().from('inventories').select('warehouse_id').eq('id', inventoryId).single(); if (error || !data?.warehouse_id) throw new Error('No fue posible resolver la bodega autorizada.'); return String(data.warehouse_id) }
  async history(inventoryId: string, warehouseId: string) { const { data, error } = await client().rpc('list_rp_releases', { p_inventory_id: inventoryId, p_warehouse_id: warehouseId }); if (error) throw new Error(error.message); return (data ?? []) as Record<string, unknown>[] }
  async preview(inventoryId: string, warehouseId: string, ids: string[]) { const { data, error } = await client().rpc('preview_rp_release', { p_inventory_id: inventoryId, p_warehouse_id: warehouseId, p_reference_ids: ids }); if (error) throw new Error(error.message); return data as Record<string, unknown> }
  async create(inventoryId: string, warehouseId: string, ids: string[], fingerprint: string, requestId: string) { const { data, error } = await client().rpc('create_rp_release', { p_inventory_id: inventoryId, p_warehouse_id: warehouseId, p_reference_ids: ids, p_expected_fingerprint: fingerprint, p_request_id: requestId }); if (error) throw new Error(error.message); return data as Record<string, unknown> }
  async detail(releaseId: string) { const { data, error } = await client().rpc('get_rp_release_detail', { p_release_id: releaseId }); if (error) throw new Error(error.message); return data as Record<string, unknown> }
  async ready(releaseId: string, requestId: string) { const { data, error } = await client().rpc('mark_rp_release_ready', { p_release_id: releaseId, p_request_id: requestId }); if (error) throw new Error(error.message); return data as Record<string, unknown> }
  async download(releaseId: string) {
    const { data, error } = await client().rpc('prepare_rp_release_export', { p_release_id: releaseId, p_request_id: crypto.randomUUID() })
    if (error) throw new Error(error.message)
    const result = data as RpReleaseExport
    const bytes = generateRpReleaseXlsx(result); validateRpReleaseXlsx(bytes, result.manifest)
    return { bytes, fileName: rpReleaseFilename(result.manifest) }
  }
}
