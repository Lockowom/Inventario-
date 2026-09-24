import { describe, expect, it, vi } from 'vitest'

const supabaseMock = vi.hoisted(() => ({ getSupabaseClient: vi.fn() }))
vi.mock('../../src/services/supabase', () => ({ getSupabaseClient: supabaseMock.getSupabaseClient }))

import { SupabaseRectificationsRepository } from '../../src/services/supabase-rectifications-repository'

describe('SupabaseRectificationsRepository', () => {
  it('usa el RPC de rectificación y envía únicamente artifact_generation_id a cada Edge Function', async () => {
    const invoke = vi.fn().mockResolvedValue({ data: { signedUrl: 'https://signed.example/file', fileName: 'file.xlsx' }, error: null })
    const rpc = vi.fn().mockResolvedValue({ data: { id: 'rectification-a', rectification_number: 3, idempotent: false }, error: null })
    supabaseMock.getSupabaseClient.mockReturnValue({ functions: { invoke }, rpc })
    const repository = new SupabaseRectificationsRepository()
    await repository.rectifyCut({ cutId: 'cut-a', countRecordId: 'record-a', physicalPayload: { ubicacion: 'A-01-01', codigo: 'SKU', serie: '', partida: '', pieza_producto: '', fecha_vencimiento: '', talla: '', color: '', cantidad_contada: 1 }, reason: 'Evidencia', requestId: 'request-a' })
    await repository.generateArtifact('artifact-a'); await repository.downloadArtifact('artifact-b')
    expect(rpc).toHaveBeenCalledWith('rectify_cut', { p_cut_id: 'cut-a', p_count_record_id: 'record-a', p_physical_payload: { ubicacion: 'A-01-01', codigo: 'SKU', serie: '', partida: '', pieza_producto: '', fecha_vencimiento: '', talla: '', color: '', cantidad_contada: 1 }, p_reason: 'Evidencia', p_request_id: 'request-a' })
    expect(invoke).toHaveBeenNthCalledWith(1, 'generate-inventory-artifact', { body: { artifact_generation_id: 'artifact-a' } })
    expect(invoke).toHaveBeenNthCalledWith(2, 'download-inventory-artifact', { body: { artifact_generation_id: 'artifact-b' } })
  })
})
