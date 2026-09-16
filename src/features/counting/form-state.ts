import type { MasterControlType } from '../../domain/master/contracts'
import type { PhysicalCountDraft } from '../../domain/count/contracts'

export const emptyPhysicalCountDraft: PhysicalCountDraft = { ubicacion: '', codigo: '', serie: '', partida: '', piezaProducto: '', fechaVencimiento: '', talla: '', color: '', cantidadContada: '' }

/** A new SKU never inherits fields whose meaning belongs to the prior SKU. */
export function resetForControlType(draft: PhysicalCountDraft, controlType: MasterControlType | null): PhysicalCountDraft {
  return { ...draft, serie: '', partida: '', piezaProducto: '', fechaVencimiento: '', talla: '', color: '', cantidadContada: controlType === 'SERIAL' ? '1' : '' }
}

/** After durable persistence, location stays to accelerate the next physical item. */
export function resetAfterSuccessfulSave(draft: PhysicalCountDraft): PhysicalCountDraft {
  return { ...emptyPhysicalCountDraft, ubicacion: draft.ubicacion }
}
