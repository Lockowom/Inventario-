import { act, render, screen } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => ({
  profile: vi.fn(), inventories: vi.fn(), summary: vi.fn(), coverage: vi.fn(), activity: vi.fn(), missions: vi.fn(),
}))

vi.mock('../../src/services/supabase-supervision-repository', () => ({
  SupabaseSupervisionRepository: class { myProfile = mocks.profile },
}))
vi.mock('../../src/services/supabase-live-monitor-repository', () => ({
  SupabaseLiveMonitorRepository: class {
    inventories = mocks.inventories
    summary = mocks.summary
    coverage = mocks.coverage
    activity = mocks.activity
    missions = mocks.missions
  },
}))

import { LiveMonitorScreen } from '../../src/features/live-monitor/live-monitor-screen'

describe('LiveMonitorScreen', () => {
  it('muestra cobertura pendiente durante C1 sin llamarla faltante', async () => {
    mocks.profile.mockResolvedValue({ role: 'ANALISTA' })
    mocks.inventories.mockResolvedValue([{ id: 'inv-live', name: 'Inventario vivo', status: 'ABIERTO' }])
    mocks.summary.mockResolvedValue({ counts: { observations: 7, counted_skus: 3, counted_units: 8 }, reference: { available_units: 9 }, missions: {}, devices: {} })
    mocks.coverage.mockResolvedValue([{ codigo: 'SKU001P', descripcion: 'Producto', reference_type: 'PARTIDA', reference_value: 'L-01', available_quantity: 2, physical_quantity: 0, coverage_status: 'PENDIENTE_DE_COBERTURA' }])
    mocks.activity.mockResolvedValue([])
    mocks.missions.mockResolvedValue([])

    render(<LiveMonitorScreen />)
    await act(async () => { await Promise.resolve(); await Promise.resolve(); await Promise.resolve(); await Promise.resolve() })

    expect(screen.getByRole('heading', { name: 'MONITOR OPERATIVO' })).toBeInTheDocument()
    expect(screen.getByText(/C1 está abierto/)).toBeInTheDocument()
    expect(screen.getByText('PENDIENTE DE COBERTURA')).toBeInTheDocument()
    expect(mocks.summary).toHaveBeenCalledWith('inv-live')
  })
})
