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
