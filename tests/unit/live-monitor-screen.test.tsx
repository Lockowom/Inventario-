import { act, fireEvent, render, screen } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => ({
  profile: vi.fn(), inventories: vi.fn(), summary: vi.fn(), coverage: vi.fn(), activity: vi.fn(), missions: vi.fn(), otaDevices: vi.fn(), findings: vi.fn(), findingDetail: vi.fn(), findingActions: vi.fn(), findingAssignees: vi.fn(), assignFinding: vi.fn(), addFindingEvidence: vi.fn(), resolveFinding: vi.fn(),
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
    otaDevices = mocks.otaDevices
    findings = mocks.findings
    findingDetail = mocks.findingDetail
    findingActions = mocks.findingActions
    findingAssignees = mocks.findingAssignees
    assignFinding = mocks.assignFinding
    addFindingEvidence = mocks.addFindingEvidence
    resolveFinding = mocks.resolveFinding
  },
}))

import { LiveMonitorScreen } from '../../src/features/live-monitor/live-monitor-screen'

describe('LiveMonitorScreen', () => {
  beforeEach(() => { vi.clearAllMocks() })
  it('muestra cobertura pendiente durante C1 sin llamarla faltante', async () => {
    mocks.profile.mockResolvedValue({ role: 'ANALISTA' })
    mocks.inventories.mockResolvedValue([{ id: 'inv-live', name: 'Inventario vivo', status: 'ABIERTO' }])
    mocks.summary.mockResolvedValue({ counts: { observations: 7, counted_skus: 3, counted_units: 8 }, reference: { available_units: 9 }, missions: {}, devices: {} })
    mocks.coverage.mockResolvedValue([{ codigo: 'SKU001P', descripcion: 'Producto', reference_type: 'PARTIDA', reference_value: 'L-01', available_quantity: 2, physical_quantity: 0, coverage_status: 'PENDIENTE_DE_COBERTURA' }])
    mocks.activity.mockResolvedValue([])
    mocks.missions.mockResolvedValue([])
    mocks.otaDevices.mockResolvedValue([])
    mocks.findings.mockResolvedValue([])

    render(<LiveMonitorScreen />)
    await act(async () => { await Promise.resolve(); await Promise.resolve(); await Promise.resolve(); await Promise.resolve() })

    expect(screen.getByRole('heading', { name: 'MONITOR OPERATIVO' })).toBeInTheDocument()
    expect(screen.getByText(/C1 está abierto/)).toBeInTheDocument()
    expect(screen.getByText('PENDIENTE DE COBERTURA')).toBeInTheDocument()
    expect(mocks.summary).toHaveBeenCalledWith('inv-live')
  })

  it('usa formularios tipados para evidencia y resolución; no envía decisión vacía', async () => {
    mocks.inventories.mockResolvedValue([{ id: 'inv-live', name: 'Inventario vivo', status: 'ABIERTO' }])
    mocks.summary.mockResolvedValue({ counts: {}, reference: {}, missions: {}, devices: {} })
    mocks.coverage.mockResolvedValue([]); mocks.activity.mockResolvedValue([]); mocks.missions.mockResolvedValue([]); mocks.otaDevices.mockResolvedValue([])
    mocks.findings.mockResolvedValue([{ id: 'finding-1', finding_type: 'PHYSICAL_DAMAGE', severity: 'CRITICAL', state: 'OPEN', source_stage: 'C1', normalized_reference_key: 'LEGACY|A', reference_type: 'LEGACY', codigo: 'A', description: 'Daño', assigned_to: null, blocks_seal: true, blocks_recount_completion: false, blocks_rp: false, blocks_close: false, evidence_count: 1, last_evidence_at: '2026-01-01T00:00:00Z' }])
    mocks.findingDetail.mockResolvedValue({ id: 'finding-1', finding_type: 'PHYSICAL_DAMAGE', severity: 'CRITICAL', status: 'OPEN', description: 'Daño', identity: { normalized_reference_key: 'LEGACY|A' }, source_stage: 'C1', inventory_name: 'Inventario vivo', warehouse_name: 'Bodega A', reported_by_name: 'Contador', reported_at: '2026-01-01T00:00:00Z', blockers: { seal: true }, evidence: [], timeline: [{ event_type: 'REPORTED', created_at: '2026-01-01T00:00:00Z' }] })
    mocks.findingActions.mockResolvedValue({ assign: false, add_evidence: true, resolve: true })

    render(<LiveMonitorScreen />)
    await act(async () => { await Promise.resolve(); await Promise.resolve(); await Promise.resolve(); await Promise.resolve() })
    await act(async () => { fireEvent.click(screen.getByRole('button', { name: 'VER DETALLE' })); await Promise.resolve(); await Promise.resolve() })
    expect(screen.getByText('Inventario: Inventario vivo · Bodega: Bodega A')).toBeInTheDocument()
    const resolve = screen.getByRole('button', { name: 'RESOLVER CON DECISIÓN TIPADA' })
    expect(resolve).toBeDisabled()
    await act(async () => { fireEvent.change(screen.getByLabelText('Nueva evidencia'), { target: { value: 'Nota física' } }) })
    await act(async () => { fireEvent.click(screen.getByRole('button', { name: 'AGREGAR EVIDENCIA' })); await Promise.resolve(); await Promise.resolve() })
    expect(mocks.addFindingEvidence).toHaveBeenCalledWith('finding-1', 'Nota física')
    await act(async () => { fireEvent.change(screen.getByLabelText('Decisión tipada'), { target: { value: 'NO_ADJUSTMENT_REQUIRED' } }); fireEvent.change(screen.getByLabelText('Nota de resolución'), { target: { value: 'Validada' } }) })
    expect(resolve).toBeEnabled()
    await act(async () => { fireEvent.click(resolve); await Promise.resolve(); await Promise.resolve() })
    expect(mocks.resolveFinding).toHaveBeenCalledWith('finding-1', 'NO_ADJUSTMENT_REQUIRED', 'Validada')
  })

  it('presenta sólo filtros visuales sobre filas ya scoped y no inventa acciones sin capability', async () => {
    mocks.inventories.mockResolvedValue([{ id: 'inv-live', name: 'Inventario vivo', status: 'ABIERTO' }])
    mocks.summary.mockResolvedValue({ counts: {}, reference: {}, missions: {}, devices: {} })
    mocks.coverage.mockResolvedValue([]); mocks.activity.mockResolvedValue([]); mocks.missions.mockResolvedValue([]); mocks.otaDevices.mockResolvedValue([])
    mocks.findings.mockResolvedValue([
      { id: 'open-critical', finding_type: 'PHYSICAL_DAMAGE', severity: 'CRITICAL', state: 'OPEN', source_stage: 'C1', normalized_reference_key: 'LEGACY|A', reference_type: 'LEGACY', codigo: 'A', description: 'Visible scoped', assigned_to: null, blocks_seal: true, evidence_count: 0 },
      { id: 'resolved-low', finding_type: 'OTHER', severity: 'LOW', state: 'RESOLVED', source_stage: 'POST_SEAL', normalized_reference_key: 'LEGACY|B', reference_type: 'LEGACY', codigo: 'B', description: 'Histórico scoped', assigned_to: 'actor', blocks_seal: false, evidence_count: 0 },
    ])
    render(<LiveMonitorScreen />)
    await act(async () => { await Promise.resolve(); await Promise.resolve(); await Promise.resolve(); await Promise.resolve() })
    expect(screen.getByText('Visible scoped')).toBeInTheDocument()
    expect(screen.getByText('Histórico scoped')).toBeInTheDocument()
    fireEvent.change(screen.getByLabelText('Severidad'), { target: { value: 'CRITICAL' } })
    expect(screen.getByText('Visible scoped')).toBeInTheDocument()
    expect(screen.queryByText('Histórico scoped')).not.toBeInTheDocument()
    expect(mocks.findings).toHaveBeenCalledWith('inv-live')
  })
})
