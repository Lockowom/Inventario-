import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { CountingScreen, type C1LookupRepository, type CountingRuntime } from '../../src/features/counting/counting-screen'
import type { MasterSku } from '../../src/domain/master/contracts'
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

const coordinator = { runInventorySync: async () => ({ claimed: 0, confirmed: 0, rejected: 0, failed: 0, conflicts: 0, diagnostic: null }), runOutstanding: async () => ({ scopes: 1, claimed: 0, confirmed: 0, rejected: 0, failed: 0, conflicts: 0, diagnostic: null }) } as unknown as SyncCoordinator

describe('CountingScreen C1 readiness', () => {
  afterEach(() => localStorage.removeItem('inven3.restored-scan-result'))

  it('shows direct C1 readiness and never renders a device-health gate', async () => {
    render(<CountingScreen runtime={runtime()} syncCoordinator={coordinator} />)
    await waitFor(() => expect(screen.getByLabelText('CODIGO')).toBeEnabled())
    expect(screen.getByText(/Estado: LISTO PARA CONTEO/)).toBeVisible()
    expect(screen.queryByText(/Health Check|Captura bloqueada por/i)).not.toBeInTheDocument()
  })

  it('shows an explicit selector for multiple authorized inventories', () => {
    const selectInventory = vi.fn()
    render(<CountingScreen runtime={null} syncCoordinator={coordinator} readiness={{ kind: 'INVENTORY_SELECTION_REQUIRED', message: 'Selecciona un inventario para comenzar el conteo.' }} inventoryContext={{ inventories: [{ id: inventoryId, name: 'Inventario A', status: 'ABIERTO' }, { id: '44444444-4444-4444-8444-444444444444', name: 'Inventario B', status: 'ABIERTO' }], inventoryId: '', activeInventory: null, loading: false, error: null, selectInventory }} />)
    expect(screen.getByText('Selecciona un inventario para comenzar el conteo.')).toBeVisible()
    fireEvent.change(screen.getByLabelText('Inventario para C1'), { target: { value: inventoryId } })
    expect(selectInventory).toHaveBeenCalledWith(inventoryId)
  })

  it('does not make SQLite a prerequisite for an online C1 context', async () => {
    render(<CountingScreen runtime={runtime()} syncCoordinator={coordinator} />)
    await waitFor(() => expect(screen.getByLabelText('CODIGO')).toBeEnabled())
    expect(screen.queryByText(/maestro SKU disponible en este dispositivo/i)).not.toBeInTheDocument()
    expect(screen.queryByRole('button', { name: 'SINCRONIZAR' })).not.toBeInTheDocument()
  })

  it('does not show a healthy outbox as a C1 preparation step', async () => {
    render(<CountingScreen runtime={runtime(0)} syncCoordinator={coordinator} />)
    await waitFor(() => expect(screen.getByLabelText('CODIGO')).toBeEnabled())
    expect(screen.queryByText('TODO SINCRONIZADO')).not.toBeInTheDocument()
    expect(screen.queryByText('Capacidad local')).not.toBeInTheDocument()
    expect(screen.getByLabelText('CODIGO')).toBeEnabled()
  })

  it('resolves an online SKU without a complete local master snapshot', async () => {
    const onlineSku: MasterSku = { inventoryId, codigo: 'QA-SKU-1', descripcion: 'Consulta directa', controlType: 'LEGACY', cachedAt: '2026-11-10T12:00:00.000Z' }
    const lookup: C1LookupRepository = {
      lookupSku: vi.fn(async () => onlineSku),
      lookupTraceability: vi.fn(async () => []),
    }
    render(<CountingScreen runtime={runtime()} syncCoordinator={coordinator} lookupRepository={lookup} />)
    const code = await screen.findByLabelText('CODIGO')
    fireEvent.change(code, { target: { value: 'qa-sku-1' } })
    fireEvent.blur(code)
    await screen.findByText('Consulta directa')
    expect(lookup.lookupSku).toHaveBeenCalledWith(inventoryId, 'QA-SKU-1')
  })

  it('shows an access failure without a manual planilla synchronization action', () => {
    render(<CountingScreen runtime={null} syncCoordinator={coordinator} readiness={{ kind: 'CONTEXT_UNAVAILABLE', message: 'No fue posible validar el contexto operativo. Reintenta.' }} />)
    expect(screen.getByText('No fue posible validar el contexto operativo. Reintenta.')).toBeVisible()
    expect(screen.queryByRole('button', { name: 'SINCRONIZAR' })).not.toBeInTheDocument()
  })

  it.each([[39, false], [40, false], [45, false], [50, true]] as const)('keeps capacity as the only durable queue blocker at %i pending counts', async (pendingCount, saveBlocked) => {
    render(<CountingScreen runtime={runtime(pendingCount)} syncCoordinator={coordinator} />)
    const code = await screen.findByLabelText('CODIGO')
    if (saveBlocked) expect(code).toBeDisabled()
    else expect(code).toBeEnabled()
  })
})
