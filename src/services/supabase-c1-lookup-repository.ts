import { z } from 'zod'
import { masterControlTypeSchema, masterSkuSchema, normalizeMasterCode, type MasterSku } from '../domain/master/contracts'
import { getSupabaseClient } from './supabase'

const skuRowSchema = z.object({
  codigo: z.string(),
  descripcion: z.string(),
  control_type: masterControlTypeSchema,
})

const traceabilityRowSchema = z.object({
  reference_value: z.string().min(1),
  expiration_date: z.string().nullable(),
})

export interface C1TraceabilityOption {
  value: string
  expirationDate: string | null
}

/**
 * Online C1 lookup boundary. The RPCs enforce the active actor, COUNT_C1,
 * inventory scope and ABIERTO state; this adapter never returns stock values.
 */
export class SupabaseC1LookupRepository {
  public async lookupSku(inventoryId: string, rawCode: string): Promise<MasterSku | null> {
    const codigo = normalizeMasterCode(rawCode)
    if (!codigo) return null
    const { data, error } = await requireClient().rpc('c1_lookup_sku', {
      p_inventory_id: inventoryId,
      p_codigo: codigo,
    })
    if (error) throw error
    const row = Array.isArray(data) ? data[0] : null
    if (!row) return null
    const parsed = skuRowSchema.parse(row)
    return masterSkuSchema.parse({
      inventoryId,
      codigo: parsed.codigo,
      descripcion: parsed.descripcion,
      controlType: parsed.control_type,
      cachedAt: new Date().toISOString(),
    })
  }

  public async lookupTraceability(inventoryId: string, rawCode: string, controlType: 'PARTIDA' | 'SERIAL'): Promise<C1TraceabilityOption[]> {
    const codigo = normalizeMasterCode(rawCode)
    if (!codigo) return []
    const { data, error } = await requireClient().rpc('c1_lookup_traceability', {
      p_inventory_id: inventoryId,
      p_codigo: codigo,
      p_control_type: controlType,
    })
    if (error) throw error
    return ((data ?? []) as unknown[]).map((row) => {
      const parsed = traceabilityRowSchema.parse(row)
      return { value: parsed.reference_value, expirationDate: parsed.expiration_date }
    })
  }
}

function requireClient() {
  const client = getSupabaseClient()
  if (!client) throw new Error('C1_LOOKUP_NOT_CONFIGURED')
  return client
}
