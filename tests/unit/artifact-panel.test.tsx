import { act, fireEvent, render, screen } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'
import { ArtifactPanel } from '../../src/features/rectifications/artifact-panel'
import type { ArtifactGeneration, CutRectification, EvidenceValues, RectificationsRepository } from '../../src/features/rectifications/contracts'

const artifact = (id: string, status: ArtifactGeneration['status'], artifact_type: ArtifactGeneration['artifact_type'], scope: ArtifactGeneration['scope']): ArtifactGeneration => ({ id, inventory_id: 'inventory-a', cut_id: 'cut-a', rectification_id: artifact_type === 'RECTIFICATION_XLSX' ? 'r1' : null, artifact_type, scope, status, created_at: '2026-09-23T00:00:00.000Z', as_of_at: null, file_name: status === 'READY' ? 'evidence.xlsx' : null, sha256: status === 'READY' ? 'a'.repeat(64) : null, size_bytes: status === 'READY' ? 20 : null, error_safe: null })
const values: EvidenceValues = { ubicacion: 'A-01-01', codigo: 'SKU', serie: '', partida: '', pieza_producto: '', fecha_vencimiento: '', talla: '', color: '', cantidad_contada: 1 }
const records: CutRectification[] = [{ id: 'r1', cut_id: 'cut-a', count_record_id: 'record-a', rectification_number: 3, old_values: values, new_values: values, reason: 'Motivo', created_at: '2026-09-23T00:00:00.000Z', created_by: 'actor-a' }]
function repository(): RectificationsRepository { return { rectifyCut: vi.fn(), rectifications: vi.fn(), artifacts: vi.fn(), masterItem: vi.fn(), generateArtifact: vi.fn().mockResolvedValue(undefined), downloadArtifact: vi.fn().mockResolvedValue({ signedUrl: 'https://signed.example/file', fileName: 'evidence.xlsx' }) } }
async function flush() { await act(async () => { await Promise.resolve(); await Promise.resolve() }) }

describe('evidencias F8', () => {
  it('filtra respaldos técnicos para ANALISTA y oculta el panel a CONTADOR', () => {
    const artifacts = [artifact('snapshot', 'REQUESTED', 'SNAPSHOT', 'CUT_SNAPSHOT'), artifact('backup', 'READY', 'TECHNICAL_BACKUP', 'CUT_READY_BACKUP')]
    const { rerender } = render(<ArtifactPanel artifacts={artifacts} finalArtifacts={[]} rectifications={records} role="ANALISTA" inventoryFrozen={false} repository={repository()} onChanged={vi.fn()} />)
    expect(screen.getByText('SNAPSHOT DEL CORTE')).toBeInTheDocument(); expect(screen.queryByText('RESPALDO TÉCNICO DEL CORTE')).not.toBeInTheDocument()
    rerender(<ArtifactPanel artifacts={artifacts} finalArtifacts={[]} rectifications={records} role="CONTADOR" inventoryFrozen={false} repository={repository()} onChanged={vi.fn()} />)
    expect(screen.queryByText('EVIDENCIAS Y RESPALDOS')).not.toBeInTheDocument()
  })

  it('representa lifecycle, procesa sólo el id y descarga la URL firmada', async () => {
    const repo = repository(); const open = vi.spyOn(window, 'open').mockImplementation(() => null)
    render(<ArtifactPanel artifacts={[artifact('requested', 'REQUESTED', 'SNAPSHOT', 'CUT_SNAPSHOT'), artifact('ready', 'READY', 'RECTIFICATION_XLSX', 'RECTIFICATION_XLSX'), artifact('failed', 'ERROR', 'SNAPSHOT', 'CUT_SNAPSHOT'), artifact('validated', 'VALIDATED', 'SNAPSHOT', 'CUT_SNAPSHOT'), artifact('generated', 'FILE_GENERATED', 'SNAPSHOT', 'CUT_SNAPSHOT'), artifact('backup', 'READY', 'TECHNICAL_BACKUP', 'CUT_READY_BACKUP')]} finalArtifacts={[artifact('final', 'READY', 'TECHNICAL_BACKUP', 'FINAL_FROZEN_BACKUP')]} rectifications={records} role="ADMIN" inventoryFrozen repository={repo} onChanged={vi.fn()} />)
    expect(screen.getByText(/PENDIENTE DE GENERACIÓN/)).toBeInTheDocument(); expect(screen.getByText(/ARCHIVO GENERADO \/ VALIDACIÓN PENDIENTE/)).toBeInTheDocument(); expect(screen.getByText(/VALIDADO \/ FINALIZACIÓN PENDIENTE/)).toBeInTheDocument(); expect(screen.getAllByText(/LISTO/).length).toBeGreaterThan(0); expect(screen.getByText(/REQUIERE REINTENTO/)).toBeInTheDocument(); expect(screen.getByText('R003 · XLSX DE RECTIFICACIÓN')).toBeInTheDocument(); expect(screen.getAllByText('RESPALDO FINAL DEL INVENTARIO').length).toBeGreaterThan(0); expect(screen.getByText('RESPALDO TÉCNICO DEL CORTE')).toBeInTheDocument()
    fireEvent.click(screen.getAllByRole('button', { name: 'PROCESAR ARTEFACTO' })[0]!); await flush()
    expect(repo.generateArtifact).toHaveBeenCalledWith('requested')
    fireEvent.click(screen.getAllByRole('button', { name: 'DESCARGAR XLSX' })[0]!); await flush()
    expect(repo.downloadArtifact).toHaveBeenCalledWith('ready'); expect(open).toHaveBeenCalledWith('https://signed.example/file', '_blank', 'noopener,noreferrer')
  })
})
