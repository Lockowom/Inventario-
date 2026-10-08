import type { RecountFindingType, RecountMission, SupabaseReconciliationRepository } from '../../services/supabase-reconciliation-repository'

type OfflineOperation =
  | { id: string; kind: 'RECORD'; missionId: string; subtaskId: string; location: string; quantity: number | null; serial: string | null; batch: string | null; logisticUnit: string | null; createdAt: string }
  | { id: string; kind: 'RESOLVE'; missionId: string; subtaskId: string; status: 'ZERO_CONFIRMED' | 'INACCESSIBLE' | 'ESCALATED'; reason: string | null; createdAt: string }
  | { id: string; kind: 'FINISH_SWEEP'; missionId: string; subtaskId: string; createdAt: string }
  | { id: string; kind: 'ADD_LOCATION'; missionId: string; location: string; logisticUnit: string | null; createdAt: string }
  | { id: string; kind: 'FINDING'; missionId: string; subtaskId: string; finding: RecountFindingType; note: string | null; createdAt: string }
type OfflineOperationInput<T = OfflineOperation> = T extends unknown ? Omit<T, 'id' | 'createdAt'> : never

const OUTBOX_KEY = 'inven3.c2-2.outbox'
const MISSION_KEY = 'inven3.c2-2.mission'

function storage(): Storage | null { try { return typeof localStorage === 'undefined' ? null : localStorage } catch { return null } }
function read<T>(key: string, fallback: T): T { try { const value = storage()?.getItem(key); return value ? JSON.parse(value) as T : fallback } catch { return fallback } }
function write(key: string, value: unknown) { try { storage()?.setItem(key, JSON.stringify(value)) } catch { /* storage remains an optimization; live data stays server-authoritative */ } }

export const recountOfflineOutbox = {
  list: (): OfflineOperation[] => read<OfflineOperation[]>(OUTBOX_KEY, []),
  pendingForMission: (missionId: string) => recountOfflineOutbox.list().filter((item) => item.missionId === missionId),
  cacheMission: (mission: RecountMission | null) => write(MISSION_KEY, mission),
  cachedMission: (): RecountMission | null => read<RecountMission | null>(MISSION_KEY, null),
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
  async flush(repository: SupabaseReconciliationRepository, missionId?: string): Promise<RecountMission | null> {
    const items = recountOfflineOutbox.list()
    let latest: RecountMission | null = null
    const remaining: OfflineOperation[] = []
    for (const item of items) {
      if (missionId && item.missionId !== missionId) { remaining.push(item); continue }
      try {
        if (item.kind === 'RECORD') latest = await repository.recordSubtask(item)
        else if (item.kind === 'RESOLVE') latest = await repository.resolveSubtask(item.subtaskId, item.status, item.reason ?? undefined)
        else if (item.kind === 'FINISH_SWEEP') latest = await repository.finishSerialSweep(item.subtaskId)
        else if (item.kind === 'ADD_LOCATION') latest = await repository.addLocation(item.missionId, item.location, item.logisticUnit ?? undefined)
        else await repository.reportFinding(item.subtaskId, item.finding, item.note ?? undefined)
      } catch { remaining.push(item) }
    }
    write(OUTBOX_KEY, remaining)
    if (latest) recountOfflineOutbox.cacheMission(latest)
    return latest
  },
}
