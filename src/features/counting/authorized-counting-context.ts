import { z } from 'zod'
import type { ActiveCountingContext } from '../../domain/count/save-physical-count'
import { authService } from '../auth/auth-service'
import { getSupabaseClient } from '../../services/supabase'

const inventoryRowSchema = z.object({ id: z.uuid(), status: z.enum(['BORRADOR', 'PREPARADO', 'ABIERTO', 'CERRADO', 'CONGELADO']) })

/** Only a server-authorized row in ABIERTO is allowed to create a local runtime. */
export function selectAuthorizedCountingContext(userId: string, rows: unknown[]): ActiveCountingContext | null {
  const open = rows.map((row) => inventoryRowSchema.safeParse(row)).flatMap((result) => result.success && result.data.status === 'ABIERTO' ? [result.data] : [])
  if (open.length !== 1) return null
  return { userId, inventoryId: open[0]!.id, inventoryStatus: 'ABIERTO' }
}

/** Saving never calls this: the local runtime receives an Auth + RLS-filtered context on entry. */
export async function loadAuthorizedCountingContext(): Promise<ActiveCountingContext | null> {
  const client = getSupabaseClient()
  const profile = await authService.getProfile()
  if (!client || !profile?.active) return null
  const { data: assignments, error: assignmentsError } = await client.from('inventory_assignments').select('inventory_id').eq('user_id', profile.user_id).eq('active', true)
  if (assignmentsError) throw assignmentsError
  const ids = (assignments ?? []).map((assignment) => assignment.inventory_id)
  if (ids.length === 0) return null
  const { data: inventories, error: inventoriesError } = await client.from('inventories').select('id, status').in('id', ids).eq('status', 'ABIERTO')
  if (inventoriesError) throw inventoriesError
  return selectAuthorizedCountingContext(profile.user_id, inventories ?? [])
}
