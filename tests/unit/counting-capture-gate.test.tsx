import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { CountingScreen, type CountingRuntime } from '../../src/features/counting/counting-screen'
import type { LocalCountRecord } from '../../src/domain/count/contracts'
import type { SyncCoordinator } from '../../src/domain/sync/sync-coordinator'

const inventoryId = '11111111-1111-4111-8111-111111111111'
const userId = '22222222-2222-4222-8222-222222222222'
const deviceId = '33333333-3333-4333-8333-333333333333'
function record(syncStatus: LocalCountRecord['syncStatus']): LocalCountRecord {
  return { id: `${syncStatus}-id`, clientCountId: `${syncStatus}-client`, inventoryId, userId, deviceId, ubicacion: 'A-01', codigo: '00001', serie: null, partida: 'P-1', piezaProducto: null, fechaVencimiento: null, talla: null, color: null, cantidadContada: 1, descripcion: 'Producto', controlType: 'PARTIDA', capturedAt: '2026-09-25T12:00:00.000Z', createdAt: '2026-09-25T12:00:00.000Z', syncStatus, syncAttempts: 0, lastSyncError: null, syncStartedAt: null, nextRetryAt: null, confirmedAt: null, serverCountId: null, lastSyncAt: null }
}

function runtime(pendingCount = 1): CountingRuntime {
  const counts = [record('PENDING'), record('CONFIRMED'), record('FAILED')]
  return {
    context: { inventoryId, userId, inventoryStatus: 'ABIERTO' },
    masters: { getMetadata: async () => ({ inventoryId, masterVersion: 1, rowCount: 1, fingerprint: 'a'.repeat(64), cachedAt: '2026-09-25T12:00:00.000Z' }), findByCode: async () => null, listByInventory: async () => [], replaceSnapshot: async () => undefined },
    counts: { getOrCreateDeviceId: async () => deviceId, countPendingByDevice: async () => pendingCount, listOwnCounts: async () => counts },
  } as unknown as CountingRuntime
}

function runtimeWithSkuLookup(findByCode = vi.fn(async () => null)): CountingRuntime {
  const value = runtime()
  return { ...value, masters: { ...value.masters, findByCode } } as CountingRuntime
}

const coordinator = { runInventorySync: async () => ({ claimed: 0, confirmed: 0, rejected: 0, failed: 0, conflicts: 0, diagnostic: null }), runOutstanding: async () => ({ scopes: 1, claimed: 0, confirmed: 0, rejected: 0, failed: 0, conflicts: 0, diagnostic: null }) } as unknown as SyncCoordinator

describe('CountingScreen Device Health capture gate', () => {
  afterEach(() => localStorage.removeItem('inven3.restored-scan-result'))
  it('blocks only new capture while preserving my counts, search, and sync', async () => {
    render(<CountingScreen runtime={runtime()} syncCoordinator={coordinator} captureGate={{ blocked: true, message: 'Captura bloqueada por Health Check. Revise los controles marcados como FAIL.' }} />)
    await waitFor(() => expect(screen.getByRole('button', { name: 'GUARDAR CONTEO' })).toBeDisabled())
    expect(screen.getAllByRole('button', { name: /Escanear/i }).every((button) => (button as HTMLButtonElement).disabled)).toBe(true)
    expect(screen.getByRole('heading', { name: 'MIS CONTEOS' })).toBeVisible()
    expect(screen.getByLabelText('Buscar por código, serie, partida o ubicación')).toBeEnabled()
    expect(screen.getByRole('button', { name: 'SINCRONIZAR AHORA' })).toBeEnabled()
    expect(screen.getByText('Pendiente de sincronización')).toBeVisible()
    expect(screen.getByText('Confirmado en servidor')).toBeVisible()
    expect(screen.getByText('Pendiente de reintento')).toBeVisible()
  })

  it.each(['READY', 'READY_OFFLINE', 'READY_WITH_WARNINGS'])('does not disable saving because Health is %s', async () => {
    render(<CountingScreen runtime={runtime()} syncCoordinator={coordinator} captureGate={{ blocked: false, message: null }} />)
    await waitFor(() => expect(screen.getByRole('button', { name: 'GUARDAR CONTEO' })).toBeEnabled())
  })

  it('blocks malformed or overlong locations in the input before saving', async () => {
    render(<CountingScreen runtime={runtime()} syncCoordinator={coordinator} captureGate={{ blocked: false, message: null }} />)
    const location = await screen.findByLabelText('UBICACION')
    expect(location).toHaveAttribute('maxlength', '8')
    fireEvent.change(location, { target: { value: 'AAAAAAAAAAAAAAAAAAAAAAAA' } })
    expect(location).toHaveValue('')
    expect(screen.getByText(/Ubicación mal digitada/i)).toBeVisible()
    fireEvent.change(location, { target: { value: 'f-32-03' } })
    expect(location).toHaveValue('F-32-03')
    fireEvent.change(location, { target: { value: 'techo' } })
    expect(location).toHaveValue('TECHO')
    fireEvent.change(location, { target: { value: 'bodega' } })
    expect(location).toHaveValue('TECHO')
  })
  it.each([
    [39, /Pendientes: 39 \/ 50/, false],
    [40, /Advertencia: existen varios conteos pendientes/, false],
    [45, /Advertencia crítica: el dispositivo está próximo al límite/, false],
    [50, /Debe sincronizar antes de continuar; GUARDAR está bloqueado/, true],
  ] as const)('certifies capacity UI at %i pending counts', async (pendingCount, expectedMessage, saveBlocked) => {
    render(<CountingScreen runtime={runtime(pendingCount)} syncCoordinator={coordinator} captureGate={{ blocked: false, message: null }} />)
    await waitFor(() => expect(screen.getByText(expectedMessage)).toBeVisible())
    const save = screen.getByRole('button', { name: 'GUARDAR CONTEO' })
    if (saveBlocked) expect(save).toBeDisabled()
    else expect(save).toBeEnabled()
  })

  it('keeps app-level runOutstanding available when authorization has no capture runtime', () => {
    render(<CountingScreen runtime={null} syncCoordinator={coordinator} captureGate={{ blocked: true, message: 'Captura bloqueada por Health Check. Revise los controles marcados como FAIL.' }} />)
    expect(screen.getByRole('button', { name: 'SINCRONIZAR AHORA' })).toBeEnabled()
    expect(screen.getByText(/Captura bloqueada por Health Check/)).toBeVisible()
  })

  it('manual sync requests an immediate retry', async () => {
    const runInventorySync = vi.fn(async () => ({ claimed: 1, confirmed: 1, rejected: 0, failed: 0, conflicts: 0, diagnostic: null }))
    const manualCoordinator = {
      runInventorySync,
      runOutstanding: vi.fn(async () => ({ scopes: 1, claimed: 1, confirmed: 1, rejected: 0, failed: 0, conflicts: 0, diagnostic: null })),
    } as unknown as SyncCoordinator

    render(<CountingScreen runtime={runtime()} syncCoordinator={manualCoordinator} captureGate={{ blocked: false, message: null }} />)
    const button = await screen.findByRole('button', { name: 'SINCRONIZAR AHORA' })
    fireEvent.click(button)
    await waitFor(() => expect(runInventorySync).toHaveBeenCalledWith(inventoryId, { forceRetry: true }))
  })

  it('keeps a restored scanner result durable while blocked, then applies it exactly once after READY', async () => {
    const findByCode = vi.fn(async () => null)
    const currentRuntime = runtimeWithSkuLookup(findByCode)
    localStorage.setItem('inven3.restored-scan-result', JSON.stringify({ field: 'codigo', value: '00001', error: null }))
    const view = render(<CountingScreen runtime={currentRuntime} syncCoordinator={coordinator} captureGate={{ blocked: true, message: 'Captura bloqueada por Health Check. Revise los controles marcados como FAIL.' }} />)

    await waitFor(() => expect(screen.getByRole('button', { name: 'GUARDAR CONTEO' })).toBeDisabled())
    expect(screen.getByLabelText('CODIGO')).toHaveValue('')
    expect(findByCode).not.toHaveBeenCalled()
    expect(localStorage.getItem('inven3.restored-scan-result')).not.toBeNull()

    view.rerender(<CountingScreen runtime={currentRuntime} syncCoordinator={coordinator} captureGate={{ blocked: false, message: null }} />)
    await waitFor(() => expect(screen.getByLabelText('CODIGO')).toHaveValue('00001'))
    expect(findByCode).toHaveBeenCalledTimes(1)
    expect(localStorage.getItem('inven3.restored-scan-result')).toBeNull()

    view.rerender(<CountingScreen runtime={currentRuntime} syncCoordinator={coordinator} captureGate={{ blocked: false, message: null }} />)
    expect(findByCode).toHaveBeenCalledTimes(1)
  })
})
