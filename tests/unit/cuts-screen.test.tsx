import { act, fireEvent, render, screen } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'

vi.mock('../../src/services/supabase', () => ({ isSupabaseConfigured: true }))

import { CutsScreen } from '../../src/features/cuts/cuts-screen'
import type { SupabaseCutsRepository } from '../../src/services/supabase-cuts-repository'

const firstPage = Array.from({ length: 100 }, (_, index) => ({ count_record_id: `count-${index + 1}`, export_seq: index + 1, snapshot: { codigo: 'SKU', cantidad_contada: 1 } }))
const secondPage = Array.from({ length: 2 }, (_, index) => ({ count_record_id: `count-${index + 101}`, export_seq: index + 101, snapshot: { codigo: 'SKU', cantidad_contada: 1 } }))

describe('detalle de corte paginado', () => {
  it('conserva la primera página y usa el último export_seq para cargar la siguiente', async () => {
    const cutsRepository = {
      inventories: vi.fn().mockResolvedValue([{ id: 'inventory-a', name: 'A', status: 'ABIERTO' }]),
      myProfile: vi.fn().mockResolvedValue({ role: 'ANALISTA', active: true }),
      cuts: vi.fn().mockResolvedValue([{ id: 'cut-a', cut_number: 1, status: 'SNAPSHOT_CREATED', record_count: 102, first_export_seq: 1, last_export_seq: 102 }]),
      createCut: vi.fn(), items: vi.fn().mockResolvedValueOnce(firstPage).mockResolvedValueOnce(secondPage), correctionContext: vi.fn(), correct: vi.fn(),
    } as unknown as SupabaseCutsRepository
    render(<CutsScreen cutsRepository={cutsRepository} />)
    await flushReact()
    fireEvent.click(screen.getByRole('button', { name: 'VER DETALLE' }))
    await flushReact()
    expect(screen.getByText('#1 · SKU · 1')).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'CARGAR MÁS' })).toBeInTheDocument()
    fireEvent.click(screen.getByRole('button', { name: 'CARGAR MÁS' }))
    await flushReact()
    expect(cutsRepository.items).toHaveBeenNthCalledWith(1, 'cut-a')
    expect(cutsRepository.items).toHaveBeenNthCalledWith(2, 'cut-a', 100)
    expect(screen.getByText('#1 · SKU · 1')).toBeInTheDocument()
    expect(screen.getByText('#102 · SKU · 1')).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: 'CARGAR MÁS' })).not.toBeInTheDocument()
  })
})

async function flushReact() {
  await act(async () => { await Promise.resolve(); await Promise.resolve(); await Promise.resolve(); await Promise.resolve() })
}
