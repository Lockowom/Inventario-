import { describe, expect, it } from 'vitest'
import { getCountSyncUiModel } from '../../src/features/counting/sync-ui-state'

describe('count sync UI state', () => {
  it('never presents stale SYNCING when the durable outbox has no pending work', () => {
    const model = getCountSyncUiModel('IDLE', 0)
    expect(model.title).toBe('TODO SINCRONIZADO')
    expect(model.action).toBeNull()
  })

  it('only exposes manual recovery for a true retry/error state with pending work', () => {
    expect(getCountSyncUiModel('RETRY_PENDING', 2)).toMatchObject({ title: 'SINCRONIZACIÓN PENDIENTE', detail: '2 conteos por enviar', action: 'RETRY' })
    expect(getCountSyncUiModel('ERROR', 1).action).toBe('RETRY')
    expect(getCountSyncUiModel('SYNCING', 1).action).toBeNull()
  })

  it('uses explicit local, offline, confirmed and rejected wording', () => {
    expect(getCountSyncUiModel('LOCAL_SAVED', 1).title).toBe('GUARDADO LOCALMENTE')
    expect(getCountSyncUiModel('OFFLINE', 2).title).toBe('OFFLINE')
    expect(getCountSyncUiModel('CONFIRMED', 0).title).toBe('TODO SINCRONIZADO')
    expect(getCountSyncUiModel('REJECTED', 0, 2)).toMatchObject({ action: 'DETAIL' })
  })
})
