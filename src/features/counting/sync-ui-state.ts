export type CountSyncUiState = 'IDLE' | 'LOCAL_SAVED' | 'SYNCING' | 'CONFIRMED' | 'OFFLINE' | 'RETRY_PENDING' | 'REJECTED' | 'ERROR'

export interface CountSyncUiModel {
  title: string
  detail: string
  action: 'RETRY' | 'DETAIL' | null
}

export function getCountSyncUiModel(state: CountSyncUiState, pending: number | null, rejected = 0): CountSyncUiModel {
  const count = pending ?? 0
  const noun = count === 1 ? 'conteo' : 'conteos'
  if (state === 'SYNCING') return { title: 'SINCRONIZANDO…', detail: `${count} ${noun} pendiente${count === 1 ? '' : 's'}`, action: null }
  if (state === 'LOCAL_SAVED') return { title: 'GUARDADO LOCALMENTE', detail: `${count} ${noun} por enviar`, action: null }
  if (state === 'OFFLINE') return { title: 'OFFLINE', detail: `${count} ${noun} guardado${count === 1 ? '' : 's'} localmente`, action: null }
  if (state === 'RETRY_PENDING' || state === 'ERROR') return { title: 'SINCRONIZACIÓN PENDIENTE', detail: `${count} ${noun} por enviar`, action: 'RETRY' }
  if (state === 'REJECTED') return { title: `${rejected || 1} conteo${rejected === 1 ? '' : 's'} requiere${rejected === 1 ? '' : 'n'} revisión`, detail: 'Revise el detalle antes de volver a intentarlo.', action: 'DETAIL' }
  return { title: 'TODO SINCRONIZADO', detail: 'No hay conteos pendientes en este dispositivo.', action: null }
}
