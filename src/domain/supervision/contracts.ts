import { z } from 'zod'

export const activityStateSchema = z.enum(['ACTIVO RECIENTEMENTE', 'SIN ACTIVIDAD RECIENTE', 'SIN DATOS'])
export type ActivityState = z.infer<typeof activityStateSchema>

/** Observation only: never claim exact online/offline presence. */
export function activityState(lastSeenAt: string | null, now = new Date()): ActivityState {
  if (!lastSeenAt) return 'SIN DATOS'
  return now.getTime() - new Date(lastSeenAt).getTime() <= 15 * 60_000 ? 'ACTIVO RECIENTEMENTE' : 'SIN ACTIVIDAD RECIENTE'
}

export interface SupervisionFilters { userId?: string; codigo?: string; serie?: string; partida?: string; ubicacion?: string; capturedFrom?: string; capturedTo?: string }
export interface SupervisionCursor { capturedAt: string; id: string }

/** Copy the user draft at the instant a search starts; later edits cannot affect its cursor. */
export function snapshotFilters(filters: SupervisionFilters): SupervisionFilters { return { ...filters } }

function localStartOfDay(value: string): Date {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(value)
  if (!match) throw new Error('Fecha de búsqueda inválida.')
  const result = new Date(Number(match[1]), Number(match[2]) - 1, Number(match[3]))
  if (result.getFullYear() !== Number(match[1]) || result.getMonth() !== Number(match[2]) - 1 || result.getDate() !== Number(match[3])) throw new Error('Fecha de búsqueda inválida.')
  return result
}

/** HTML date inputs are calendar days in the operator's local zone, never UTC days. */
export function localDateRangeToUtc(filters: SupervisionFilters) {
  const from = filters.capturedFrom ? localStartOfDay(filters.capturedFrom) : undefined
  const toExclusive = filters.capturedTo ? localStartOfDay(filters.capturedTo) : undefined
  if (toExclusive) toExclusive.setDate(toExclusive.getDate() + 1)
  if (from && toExclusive && toExclusive <= from) throw new Error('El rango de fechas no es válido.')
  return { capturedFrom: from?.toISOString() ?? null, capturedToExclusive: toExclusive?.toISOString() ?? null }
}
