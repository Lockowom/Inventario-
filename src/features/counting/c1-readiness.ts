import { resolveCountingContext, type ResolvedCountingContext } from '../../domain/count/resolve-counting-context'
import { getCountingContextRepository } from './counting-runtime'
import { verifyServerCountingContext } from './authorized-counting-context'

export type C1Readiness =
  | { kind: 'C1_READY'; context: Extract<ResolvedCountingContext, { kind: 'ONLINE' | 'OFFLINE' }>['context']; offline: boolean; message: string }
  | { kind: 'INVENTORY_SELECTION_REQUIRED'; message: string }
  | { kind: 'USER_NOT_READY'; message: string }
  | { kind: 'CONTEXT_UNAVAILABLE'; message: string }

/**
 * C1 opens after the server has validated the actor's current authorization
 * for one ABIERTO inventory. The full Maestro and reference snapshots are
 * never a prerequisite: online lookup is demand-driven and SQLite is only an
 * offline cache/outbox.
 */
export async function resolveC1Readiness(activeInventoryId?: string): Promise<C1Readiness> {
  const contexts = getCountingContextRepository()
  const resolved = await resolveCountingContext({ verifyServer: verifyServerCountingContext }, contexts, activeInventoryId)
  if (resolved.kind === 'SELECTION_REQUIRED') return { kind: 'INVENTORY_SELECTION_REQUIRED', message: 'Selecciona un inventario para comenzar el conteo.' }
  if (resolved.kind === 'BLOCKED') {
    if (resolved.reason === 'NOT_AUTHORIZED') return { kind: 'USER_NOT_READY', message: 'Tu usuario no está autorizado para operar C1.' }
    return { kind: 'CONTEXT_UNAVAILABLE', message: 'No fue posible validar el contexto operativo. Reintenta.' }
  }

  console.info('INVEN3_CONTEXT C1_READY')
  return {
    kind: 'C1_READY',
    context: resolved.context,
    offline: resolved.kind === 'OFFLINE',
    message: resolved.kind === 'OFFLINE' ? 'C1 listo para operar offline con productos disponibles localmente.' : 'C1 listo para conteo.',
  }
}
