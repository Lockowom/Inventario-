import type { InventoryAnomaly } from './detect-inventory-anomalies'

export type ReconciliationStatus = 'PENDIENTE_ANALISIS' | 'EN_RECONTEO' | 'FISICO_CONFIRMADO' | 'RESUELTO'

export type ReconciliationDisposition =
  | 'SIN_AJUSTE'
  | 'AJUSTE_PROPUESTO'
  | 'ERROR_DIGITACION_CONFIRMADO'
  | 'ALTA_EN_SISTEMA_PROPUESTA'
  | 'BAJA_EN_SISTEMA_PROPUESTA'
  | 'OTRO'

export interface ReconciliationDecision {
  status: 'RESUELTO'
  disposition: ReconciliationDisposition
  reason: string
  analystUserId: string
  decidedAt: string
}

export interface ReconciliationCase {
  id: string
  anomaly: InventoryAnomaly
  status: ReconciliationStatus
  confirmedPhysicalQuantity: number | null
  decision: ReconciliationDecision | null
}

export function createReconciliationCase(id: string, anomaly: InventoryAnomaly): ReconciliationCase {
  return { id, anomaly, status: 'PENDIENTE_ANALISIS', confirmedPhysicalQuantity: null, decision: null }
}

export function markPhysicalConfirmed(item: ReconciliationCase, quantity: number): ReconciliationCase {
  if (!Number.isInteger(quantity) || quantity < 0) throw new Error('Cantidad física confirmada inválida.')
  return { ...item, status: 'FISICO_CONFIRMADO', confirmedPhysicalQuantity: quantity }
}

export function resolveReconciliation(item: ReconciliationCase, input: Omit<ReconciliationDecision, 'status'>, role: 'CONTADOR' | 'ANALISTA' | 'ADMIN'): ReconciliationCase {
  if (role !== 'ANALISTA') throw new Error('El dictamen de conciliación está reservado al ANALISTA.')
  if (!input.reason.trim()) throw new Error('El dictamen requiere una justificación.')
  return { ...item, status: 'RESUELTO', decision: { ...input, status: 'RESUELTO', reason: input.reason.trim() } }
}

export function requiresSystemAdjustment(item: ReconciliationCase) {
  return item.decision?.disposition === 'AJUSTE_PROPUESTO'
}
