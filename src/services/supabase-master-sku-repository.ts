import { masterMetadataSchema, masterSkuSchema, type MasterMetadata, type MasterSku } from '../domain/master/contracts'
import type { MasterSkuRepository, MasterSnapshot } from '../domain/ports/master-sku-repository'
import { getSupabaseClient } from './supabase'

const MASTER_PAGE_SIZE = 1_000

export class SupabaseMasterSkuRepository implements MasterSkuRepository {
  public async findByCode(inventoryId: string, codigo: string): Promise<MasterSku | null> {
    const client = requireClient()
    const { data, error } = await client.from('inventory_master_items').select('inventory_id, codigo, descripcion, control_type, created_at').eq('inventory_id', inventoryId).eq('codigo', codigo.trim().toUpperCase()).maybeSingle()
    if (error) throw error
    return data ? parseMasterSku(data) : null
  }

  public async listByInventory(inventoryId: string): Promise<MasterSku[]> {
    const client = requireClient()
    const items: MasterSku[] = []
    // PostgREST en QA limita una respuesta a una página. El maestro puede
    // tener miles de SKU: cargar sólo la primera página hacía que Health
    // rechazara un snapshot remoto correcto como si no existiera localmente.
    for (let from = 0; ; from += MASTER_PAGE_SIZE) {
      const { data, error } = await client
        .from('inventory_master_items')
        .select('inventory_id, codigo, descripcion, control_type, created_at')
        .eq('inventory_id', inventoryId)
        .order('codigo')
        .range(from, from + MASTER_PAGE_SIZE - 1)
      if (error) throw error
      const page = (data ?? []).map(parseMasterSku)
      items.push(...page)
      if (page.length < MASTER_PAGE_SIZE) return items
    }
  }

  public async getMetadata(inventoryId: string): Promise<MasterMetadata | null> {
    const client = requireClient()
    const { data, error } = await client.from('inventory_master_metadata').select('inventory_id, master_version, row_count, fingerprint, cached_at').eq('inventory_id', inventoryId).maybeSingle()
    if (error) throw error
    return data ? parseMasterMetadata(data) : null
  }

  public async replaceSnapshot(snapshot: MasterSnapshot): Promise<void> {
    const client = requireClient()
    const { error } = await client.rpc('import_inventory_master', {
      target_inventory_id: snapshot.metadata.inventoryId,
      import_items: snapshot.items.map((item) => ({ codigo: item.codigo, descripcion: item.descripcion })),
      import_source: 'CLIENT_SNAPSHOT',
      import_identifier: snapshot.metadata.fingerprint,
    })
    if (error) throw error
  }

  public async importPreview(inventoryId: string, items: ReadonlyArray<Pick<MasterSku, 'codigo' | 'descripcion'>>, importIdentifier: string): Promise<MasterMetadata> {
    const client = requireClient()
    const { data, error } = await client.rpc('import_inventory_master', { target_inventory_id: inventoryId, import_items: items, import_source: 'FILE', import_identifier: importIdentifier })
    if (error) throw error
    const result = Array.isArray(data) ? data[0] : data
    if (!result) throw new Error('La importación no devolvió metadata.')
    return parseMasterMetadata({ inventory_id: inventoryId, master_version: result.master_version, row_count: result.row_count, fingerprint: result.fingerprint, cached_at: new Date().toISOString() })
  }

  public async addException(inventoryId: string, codigo: string, descripcion: string, reason: string): Promise<MasterMetadata> {
    const client = requireClient()
    const { data, error } = await client.rpc('add_master_exception', { target_inventory_id: inventoryId, raw_codigo: codigo, raw_descripcion: descripcion, exception_reason: reason })
    if (error) throw error
    const result = Array.isArray(data) ? data[0] : data
    if (!result) throw new Error('La excepción no devolvió metadata.')
    return parseMasterMetadata({ inventory_id: inventoryId, master_version: result.master_version, row_count: result.row_count, fingerprint: result.fingerprint, cached_at: new Date().toISOString() })
  }
}

function requireClient() {
  const client = getSupabaseClient()
  if (!client) throw new Error('Supabase no está configurado.')
  return client
}

function parseMasterSku(value: { inventory_id: string; codigo: string; descripcion: string; control_type: string; created_at: string }): MasterSku {
  return masterSkuSchema.parse({
    inventoryId: value.inventory_id,
    codigo: value.codigo,
    descripcion: value.descripcion,
    controlType: value.control_type,
    cachedAt: normalizePostgresTimestamp(value.created_at),
  })
}

function parseMasterMetadata(value: { inventory_id: string; master_version: number; row_count: number; fingerprint: string; cached_at: string }): MasterMetadata {
  return masterMetadataSchema.parse({
    inventoryId: value.inventory_id,
    masterVersion: value.master_version,
    rowCount: value.row_count,
    fingerprint: value.fingerprint,
    cachedAt: normalizePostgresTimestamp(value.cached_at),
  })
}

export function normalizePostgresTimestamp(value: string): string {
  const parsed = new Date(value)
  if (Number.isNaN(parsed.getTime())) throw new Error('Timestamp remoto inválido.')
  return parsed.toISOString()
}
