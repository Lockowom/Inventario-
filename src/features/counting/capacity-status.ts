import { pendingCapacity, type PendingCapacity } from '../../domain/count/contracts'

export interface CapacityStatus { pending: number; capacity: PendingCapacity; message: string }

export function getCapacityStatus(pending: number): CapacityStatus {
  const capacity = pendingCapacity(pending)
  if (capacity === 'BLOCKED') return { pending, capacity, message: `Pendientes: ${pending} / 50. Debe sincronizar antes de continuar; GUARDAR está bloqueado.` }
  if (capacity === 'CRITICAL') return { pending, capacity, message: `Pendientes: ${pending} / 50. Advertencia crítica: el dispositivo está próximo al límite de 50 conteos pendientes.` }
  if (capacity === 'WARNING') return { pending, capacity, message: `Pendientes: ${pending} / 50. Advertencia: existen varios conteos pendientes de sincronización.` }
  return { pending, capacity, message: `Pendientes: ${pending} / 50` }
}
