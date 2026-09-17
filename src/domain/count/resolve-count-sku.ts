import { normalizeMasterCode, type MasterSku } from '../master/contracts'
import type { MasterSkuRepository } from '../ports/master-sku-repository'
import type { PhysicalCountDraft } from './contracts'

export interface CountSkuResolution {
  master: MasterSku | null
  draft: PhysicalCountDraft
  error: string | null
}

/** Shared local-only resolution for typed and scanned codes. */
export async function resolveCountSku(inventoryId: string, rawCode: string, draft: PhysicalCountDraft, masters: MasterSkuRepository): Promise<CountSkuResolution> {
  const codigo = normalizeMasterCode(rawCode)
  const clearedDraft: PhysicalCountDraft = { ...draft, codigo, serie: '', partida: '', piezaProducto: '', fechaVencimiento: '', talla: '', color: '', cantidadContada: '' }
  if (!codigo) return { master: null, draft: clearedDraft, error: null }
  const master = await masters.findByCode(inventoryId, codigo)
  if (!master) return { master: null, draft: clearedDraft, error: 'Código mal ingresado' }
  return { master, draft: { ...clearedDraft, cantidadContada: master.controlType === 'SERIAL' ? '1' : '' }, error: null }
}
