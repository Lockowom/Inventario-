import type { RecountFindingType, RecountMission, SupabaseReconciliationRepository } from '../../services/supabase-reconciliation-repository'

type RecountFlushRepository = Pick<SupabaseReconciliationRepository, 'recordSubtask' | 'resolveSubtask' | 'finishSerialSweep' | 'addLocation' | 'reportFinding'>

type OfflineReview = { syncState?: 'PENDING' | 'REVIEW_REQUIRED'; reviewReason?: 'AUTHORIZATION_REVOKED' | 'MISSION_ASSIGNMENT_CHANGED' }
export type OfflineOperation =
  | ({ id: string; kind: 'RECORD'; missionId: string; subtaskId: string; location: string; quantity: number | null; serial: string | null; batch: string | null; logisticUnit: string | null; createdAt: string } & OfflineReview)
  | ({ id: string; kind: 'RESOLVE'; missionId: string; subtaskId: string; status: 'ZERO_CONFIRMED' | 'INACCESSIBLE' | 'ESCALATED'; reason: string | null; createdAt: string } & OfflineReview)
  | ({ id: string; kind: 'FINISH_SWEEP'; missionId: string; subtaskId: string; createdAt: string } & OfflineReview)
  | ({ id: string; kind: 'ADD_LOCATION'; missionId: string; location: string; logisticUnit: string | null; createdAt: string } & OfflineReview)
  | ({ id: string; kind: 'FINDING'; missionId: string; subtaskId: string; finding: RecountFindingType; note: string | null; createdAt: string } & OfflineReview)
type OfflineOperationInput<T = OfflineOperation> = T extends unknown ? Omit<T, 'id' | 'createdAt'> : never

const OUTBOX_KEY = 'inven3.c2-2.outbox'
const MISSION_KEY = 'inven3.c2-2.mission'
let activeActorId: string | null = null

function storage(): Storage | null { try { return typeof localStorage === 'undefined' ? null : localStorage } catch { return null } }
function actorKey(key: string) { return activeActorId ? `${key}:${activeActorId}` : `${key}:anonymous` }
function read<T>(key: string, fallback: T): T { try { const value = storage()?.getItem(actorKey(key)); return value ? JSON.parse(value) as T : fallback } catch { return fallback } }
function write(key: string, value: unknown) { try { storage()?.setItem(actorKey(key), JSON.stringify(value)) } catch { /* storage remains an optimization; live data stays server-authoritative */ } }
function blindMission(mission: RecountMission | null): RecountMission | null {
  return mission?.round === 3 ? { ...mission, reference_value: null } : mission
}
function terminalAuthorizationReason(error: unknown): OfflineReview['reviewReason'] | null {
  const message = error instanceof Error ? error.message : String(error)
  if (message.includes('AUTHORIZATION_REVOKED')) return 'AUTHORIZATION_REVOKED'
  if (message.includes('MISSION_ASSIGNMENT_CHANGED') || message.includes('not assigned to actor')) return 'MISSION_ASSIGNMENT_CHANGED'
  return null
}

export const recountOfflineOutbox = {
  setActor(actorId: string | null) { activeActorId = actorId },
  activeActor: () => activeActorId,
  list: (): OfflineOperation[] => read<OfflineOperation[]>(OUTBOX_KEY, []),
  pendingForMission: (missionId: string) => recountOfflineOutbox.list().filter((item) => item.missionId === missionId && item.syncState !== 'REVIEW_REQUIRED'),
  reviewRequiredForMission: (missionId: string) => recountOfflineOutbox.list().filter((item) => item.missionId === missionId && item.syncState === 'REVIEW_REQUIRED'),
  cacheMission: (mission: RecountMission | null) => write(MISSION_KEY, blindMission(mission)),
  cachedMission: (): RecountMission | null => blindMission(read<RecountMission | null>(MISSION_KEY, null)),
  clearMission: () => write(MISSION_KEY, null),
  enqueue(operation: OfflineOperationInput) {
    const pending = recountOfflineOutbox.list()
    if (operation.kind === 'RECORD' && operation.serial) {
      const duplicate = pending.some((item) => item.kind === 'RECORD' && item.subtaskId === operation.subtaskId && item.serial === operation.serial)
      if (duplicate) throw new Error('SERIE YA ESCANEADA EN ESTE BARRIDO')
    }
    const item = { ...operation, id: crypto.randomUUID(), createdAt: new Date().toISOString() } as OfflineOperation
    write(OUTBOX_KEY, [...pending, item])
    return item
  },
  async flush(repository: RecountFlushRepository, missionId?: string): Promise<RecountMission | null> {
    const items = recountOfflineOutbox.list()
    let latest: RecountMission | null = null
    const remaining: OfflineOperation[] = []
    for (const item of items) {
      if (missionId && item.missionId !== missionId) { remaining.push(item); continue }
      if (item.syncState === 'REVIEW_REQUIRED') { remaining.push(item); continue }
      try {
        if (item.kind === 'RECORD') latest = await repository.recordSubtask(item)
        else if (item.kind === 'RESOLVE') latest = await repository.resolveSubtask(item.subtaskId, item.status, item.reason ?? undefined)
        else if (item.kind === 'FINISH_SWEEP') latest = await repository.finishSerialSweep(item.subtaskId)
        else if (item.kind === 'ADD_LOCATION') latest = await repository.addLocation(item.missionId, item.location, item.logisticUnit ?? undefined)
        else await repository.reportFinding(item.subtaskId, item.finding, item.note ?? undefined)
      } catch (error) {
        const reviewReason = terminalAuthorizationReason(error)
        remaining.push(reviewReason ? { ...item, syncState: 'REVIEW_REQUIRED', reviewReason } : item)
      }
    }
    write(OUTBOX_KEY, remaining)
    if (latest) recountOfflineOutbox.cacheMission(latest)
    return latest
  },
}
