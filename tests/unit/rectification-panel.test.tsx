import { act, fireEvent, render, screen } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { RectificationPanel } from '../../src/features/rectifications/rectification-panel'
import type { CutRectification, RectificationsRepository } from '../../src/features/rectifications/contracts'

const item = { count_record_id: 'record-a', export_seq: 7, snapshot: { ubicacion: 'A-01-01', codigo: 'SKU-S', serie: 'SER-1', partida: '', pieza_producto: '', fecha_vencimiento: '', talla: '', color: '', cantidad_contada: 1, descripcion: 'Original' } }
const history: CutRectification[] = [
  { id: 'r1', cut_id: 'cut-a', count_record_id: 'record-a', rectification_number: 1, old_values: item.snapshot, new_values: { ...item.snapshot, cantidad_contada: 3 }, reason: 'Primera', created_at: '2026-09-23T00:00:00.000Z', created_by: 'actor-a' },
  { id: 'r2', cut_id: 'cut-a', count_record_id: 'record-b', rectification_number: 2, old_values: item.snapshot, new_values: { ...item.snapshot, cantidad_contada: 2 }, reason: 'Otro registro', created_at: '2026-09-23T00:01:00.000Z', created_by: 'actor-b' },
  { id: 'r3', cut_id: 'cut-a', count_record_id: 'record-a', rectification_number: 3, old_values: { ...item.snapshot, cantidad_contada: 3 }, new_values: { ...item.snapshot, cantidad_contada: 4 }, reason: 'Tercera', created_at: '2026-09-23T00:02:00.000Z', created_by: 'actor-a' },
]

function repository(): RectificationsRepository {
  return { rectifyCut: vi.fn(), rectifications: vi.fn(), artifacts: vi.fn(), generateArtifact: vi.fn(), downloadArtifact: vi.fn(), masterItem: vi.fn().mockResolvedValue({ codigo: 'SKU-S', descripcion: 'Legacy', control_type: 'LEGACY' }) }
}
async function flush() { await act(async () => { await Promise.resolve(); await Promise.resolve(); await Promise.resolve() }) }

describe('rectificaciones post-corte', () => {
  beforeEach(() => { vi.spyOn(window, 'confirm').mockReturnValue(true); vi.stubGlobal('crypto', { randomUUID: vi.fn().mockReturnValueOnce('request-stable').mockReturnValueOnce('request-next') }) })

  it('oculta RECTIFICAR al CONTADOR y no crea panel de gestión', () => {
    render(<RectificationPanel inventoryId="inventory-a" cut={{ id: 'cut-a', cut_number: 4, status: 'READY' }} items={[item]} rectifications={history} role="CONTADOR" repository={repository()} onChanged={vi.fn()} />)
    expect(screen.queryByRole('button', { name: 'RECTIFICAR' })).not.toBeInTheDocument()
  })

  it('prefill del último estado efectivo y conserva R001/R003 sin mezclar R002', async () => {
    render(<RectificationPanel inventoryId="inventory-a" cut={{ id: 'cut-a', cut_number: 4, status: 'READY' }} items={[item]} rectifications={history} role="ANALISTA" repository={repository()} onChanged={vi.fn()} />)
    fireEvent.click(screen.getByRole('button', { name: 'RECTIFICAR' })); await flush()
    expect(screen.getByText('RECTIFICACIÓN POST-CORTE')).toBeInTheDocument()
    expect(screen.getByDisplayValue('4')).toBeInTheDocument()
    expect(screen.getByText('R001')).toBeInTheDocument(); expect(screen.getByText('R003')).toBeInTheDocument()
    expect(screen.queryByText('R002')).not.toBeInTheDocument()
  })

  it('reutiliza request_id tras un fallo y preserva el motivo', async () => {
    const repo = repository(); const rectify = vi.mocked(repo.rectifyCut).mockRejectedValueOnce(new Error('Failed to fetch')).mockResolvedValueOnce({ id: 'r4', rectification_number: 4, idempotent: false }).mockResolvedValueOnce({ id: 'r5', rectification_number: 5, idempotent: false })
    render(<RectificationPanel inventoryId="inventory-a" cut={{ id: 'cut-a', cut_number: 4, status: 'READY' }} items={[item]} rectifications={history} role="ADMIN" repository={repo} onChanged={vi.fn()} />)
    fireEvent.click(screen.getByRole('button', { name: 'RECTIFICAR' })); await flush()
    fireEvent.change(screen.getByLabelText('MOTIVO OBLIGATORIO'), { target: { value: 'Corrección comprobada' } })
    fireEvent.click(screen.getByRole('button', { name: 'GUARDAR RECTIFICACIÓN' })); await flush()
    expect(screen.getByText('Rectificaciones y evidencias requieren conexión al servidor. No se realizó ningún cambio.')).toBeInTheDocument()
    expect(screen.getByLabelText('MOTIVO OBLIGATORIO')).toHaveValue('Corrección comprobada')
    fireEvent.click(screen.getByRole('button', { name: 'GUARDAR RECTIFICACIÓN' })); await flush()
    expect(rectify).toHaveBeenCalledTimes(2)
    expect(rectify.mock.calls[0]![0].requestId).toBe('request-stable')
    expect(rectify.mock.calls[1]![0].requestId).toBe('request-stable')
    expect(rectify.mock.calls[0]![0].physicalPayload).not.toHaveProperty('descripcion')
    fireEvent.change(screen.getByLabelText('MOTIVO OBLIGATORIO'), { target: { value: 'Nueva rectificación' } })
    fireEvent.click(screen.getByRole('button', { name: 'GUARDAR RECTIFICACIÓN' })); await flush()
    expect(rectify.mock.calls[2]![0].requestId).toBe('request-next')
  })

  it('aplica controles de SERIAL y PARTIDA como ayuda UX', async () => {
    const serial = repository(); vi.mocked(serial.masterItem).mockResolvedValue({ codigo: 'SKU-S', descripcion: 'Serial', control_type: 'SERIAL' })
    const { rerender } = render(<RectificationPanel inventoryId="inventory-a" cut={{ id: 'cut-a', cut_number: 4, status: 'READY' }} items={[item]} rectifications={[]} role="ANALISTA" repository={serial} onChanged={vi.fn()} />)
    fireEvent.click(screen.getByRole('button', { name: 'RECTIFICAR' })); await flush()
    expect(screen.getByLabelText(/PARTIDA/)).toBeDisabled(); expect(screen.getByLabelText('Cantidad Contada')).toBeDisabled()
    const batch = repository(); vi.mocked(batch.masterItem).mockResolvedValue({ codigo: 'SKU-S', descripcion: 'Partida', control_type: 'PARTIDA' })
    rerender(<RectificationPanel inventoryId="inventory-a" cut={{ id: 'cut-a', cut_number: 4, status: 'READY' }} items={[item]} rectifications={[]} role="ANALISTA" repository={batch} onChanged={vi.fn()} />); await flush()
    expect(screen.getByLabelText('SERIE')).toBeDisabled(); expect(screen.getByLabelText(/PARTIDA/)).not.toBeDisabled()
  })
})
