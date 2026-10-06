import { z } from 'zod'
import type { AppRole } from '../auth/contracts'

/** A monitor observes all count rounds; its events never replace canonical RPC state. */
export const liveMonitorStageSchema = z.enum(['C1', 'C2', 'C3'])
export type LiveMonitorStage = z.infer<typeof liveMonitorStageSchema>

export const liveMonitorEventTypeSchema = z.enum([
  'COUNT_RECEIVED',
  'COUNT_SYNC_CONFIRMED',
  'COUNT_SYNC_REJECTED',
  'C1_REFERENCE_UPDATED',
  'C1_COMPLETED',
  'C2_CREATED',
  'C2_CLAIMED',
  'C2_OBSERVATION_RECEIVED',
  'C2_COMPLETED',
  'C2_CONFIRMED_ZERO',
  'C3_CREATED',
  'C3_CLAIMED',
  'C3_OBSERVATION_RECEIVED',
  'C3_COMPLETED',
  'C3_CONFIRMED_ZERO',
  'PHYSICAL_CONFIRMED',
  'RECONCILIATION_CASE_CREATED',
  'RECONCILIATION_RESOLVED',
  'ADJUSTMENT_PROPOSED',
  'SYNC_WARNING',
  'DEVICE_OFFLINE_PENDING',
  'MASTER_CHANGED',
  'SYSTEM_REFERENCE_CHANGED',
  'REALTIME_RECONNECTED',
])
export type LiveMonitorEventType = z.infer<typeof liveMonitorEventTypeSchema>

export const coverageStatusSchema = z.enum([
  'CUBIERTA',
  'PENDIENTE_DE_COBERTURA',
  'SERIE_SISTEMA_NO_CONTADA',
  'PARTIDA_SISTEMA_NO_CONTADA',
  'SKU_SISTEMA_NO_CONTADO',
  'SERIE_FISICA_NO_EN_SISTEMA',
  'PARTIDA_FISICA_NO_EN_SISTEMA',
  'SERIE_FUERA_DE_DISPONIBLE',
  'PARTIDA_FUERA_DE_DISPONIBLE',
])
export type CoverageStatus = z.infer<typeof coverageStatusSchema>

export const identityReconciliationStatusSchema = z.enum([
  'CUADRADO_TOTAL',
  'CUADRADO_CANTIDAD_CON_DIFERENCIA_REFERENCIAS',
  'DIFERENCIA_CANTIDAD',
  'PENDIENTE_COBERTURA',
  'FISICO_CONFIRMADO_CON_DIFERENCIA_IDENTIDAD',
  'POSIBLE_DESCUADRE_IDENTIDAD',
  'RIESGO_INFLACION_STOCK',
])
export type IdentityReconciliationStatus = z.infer<typeof identityReconciliationStatusSchema>

export const monitorMissionStatusSchema = z.enum(['NUEVO', 'EN_COLA', 'ASIGNADO', 'ACTIVO', 'COMPLETADO', 'CONFIRMADO_CERO'])
export type MonitorMissionStatus = z.infer<typeof monitorMissionStatusSchema>

export interface CoverageReference {
  referenceType: 'SERIAL' | 'PARTIDA' | 'LEGACY'
  systemAvailableQuantity: number
  physicalQuantity: number
  inventoryStatus: 'ABIERTO' | 'C1_COMPLETADO' | 'CONCILIACION_FINAL' | 'CERRADO' | 'CONGELADO'
}

/**
 * Before C1 closes, absence is only a coverage gap.  It becomes a missing
 * reference only once the lifecycle has explicitly moved beyond C1.
 */
export function coverageStatusForReference(reference: CoverageReference): CoverageStatus {
  if (reference.systemAvailableQuantity <= 0 && reference.physicalQuantity > 0) {
    if (reference.referenceType === 'SERIAL') return 'SERIE_FUERA_DE_DISPONIBLE'
    if (reference.referenceType === 'PARTIDA') return 'PARTIDA_FUERA_DE_DISPONIBLE'
    return 'CUBIERTA'
  }
  if (reference.systemAvailableQuantity > 0 && reference.physicalQuantity > 0) return 'CUBIERTA'
  if (reference.systemAvailableQuantity > 0 && reference.inventoryStatus === 'ABIERTO') return 'PENDIENTE_DE_COBERTURA'
  if (reference.systemAvailableQuantity > 0 && reference.referenceType === 'SERIAL') return 'SERIE_SISTEMA_NO_CONTADA'
  if (reference.systemAvailableQuantity > 0 && reference.referenceType === 'PARTIDA') return 'PARTIDA_SISTEMA_NO_CONTADA'
  return 'SKU_SISTEMA_NO_CONTADO'
}

/** Quantity equality cannot settle a controlled reference whose identities differ. */
export function identityReconciliationStatus(input: {
  systemQuantity: number
  physicalQuantity: number
  identitiesMatch: boolean
  c1Open: boolean
  physicalConfirmed: boolean
}): IdentityReconciliationStatus {
  if (input.c1Open && input.systemQuantity > 0 && input.physicalQuantity === 0) return 'PENDIENTE_COBERTURA'
  if (input.systemQuantity !== input.physicalQuantity) return 'DIFERENCIA_CANTIDAD'
  if (input.identitiesMatch) return 'CUADRADO_TOTAL'
  return input.physicalConfirmed
    ? 'FISICO_CONFIRMADO_CON_DIFERENCIA_IDENTIDAD'
    : 'CUADRADO_CANTIDAD_CON_DIFERENCIA_REFERENCIAS'
}

/** CONTADOR remains blind to monitor data and prior-round differences. */
export function canAccessLiveMonitor(role: AppRole | null): boolean {
  return role === 'ANALISTA' || role === 'ADMIN'
}
