import { act, fireEvent, render, screen } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => ({
  inventories: vi.fn(), myProfile: vi.fn(), supervision: vi.fn(), mine: vi.fn(), search: vi.fn(),
}))

vi.mock('../../src/services/supabase', () => ({ isSupabaseConfigured: true, getSupabaseClient: vi.fn() }))
vi.mock('../../src/services/supabase-supervision-repository', () => ({
  SupabaseSupervisionRepository: class {
    inventories = mocks.inventories
    myProfile = mocks.myProfile
    supervision = mocks.supervision
    mine = mocks.mine
    search = mocks.search
  },
}))

import { SupervisionScreen } from '../../src/features/supervision/supervision-screen'

const rows = Array.from({ length: 50 }, (_, index) => ({
  id: `count-${index}`, codigo: `A-${index}`, cantidad_contada: 1, ubicacion: 'A-01-01', display_name: 'Counter',
  captured_at: '2026-09-17T12:00:00Z', received_at: '2026-09-17T12:01:00Z', inventory_status_at_receive: 'ABIERTO',
}))

describe('supervision search refresh behavior', () => {
  beforeEach(() => {
    vi.useFakeTimers()
    mocks.inventories.mockResolvedValue([{ id: 'inventory-a', name: 'A', status: 'ABIERTO' }])
    mocks.myProfile.mockResolvedValue({ role: 'ADMIN', display_name: 'Admin', active: true })
    mocks.supervision.mockResolvedValue({ summary: {}, counters: [], devices: [], possible_duplicate_serials: [] })
    mocks.mine.mockResolvedValue({})
    mocks.search.mockResolvedValueOnce(rows).mockResolvedValueOnce([])
  })
  afterEach(() => { vi.useRealTimers(); vi.clearAllMocks() })

  it('preserves an investigation during manual/polled refresh and pages with applied filters', async () => {
    render(<SupervisionScreen />)
    await flushReact()
    expect(mocks.supervision).toHaveBeenCalled()

    fireEvent.change(screen.getByLabelText('CODIGO'), { target: { value: 'A' } })
    fireEvent.click(screen.getByRole('button', { name: 'BUSCAR' }))
    await flushReact()
    expect(screen.getByRole('button', { name: 'CARGAR MÁS' })).toBeInTheDocument()

    fireEvent.change(screen.getByLabelText('CODIGO'), { target: { value: 'B' } })
    fireEvent.click(screen.getByRole('button', { name: 'ACTUALIZAR' }))
    await flushReact()
    expect(screen.getByText('A-0 · 1')).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'CARGAR MÁS' })).toBeInTheDocument()

    await act(async () => { await vi.advanceTimersByTimeAsync(60_000) })
    expect(screen.getByText('A-0 · 1')).toBeInTheDocument()
    fireEvent.click(screen.getByRole('button', { name: 'CARGAR MÁS' }))
    await flushReact()
    expect(mocks.search).toHaveBeenCalledTimes(2)
    const loadMoreFilters = mocks.search.mock.calls[1]?.[1]
    expect(loadMoreFilters).toMatchObject({ codigo: 'A' })
  })
})

async function flushReact() {
  await act(async () => { await Promise.resolve(); await Promise.resolve(); await Promise.resolve(); await Promise.resolve() })
}
