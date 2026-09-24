import type { ArtifactGeneration, CutRectification, MasterItem, RectificationResult, RectificationsRepository, RectifyCutInput } from '../features/rectifications/contracts'
import { getSupabaseClient } from './supabase'

function clientOrThrow() {
  const client = getSupabaseClient()
  if (!client) throw new Error('Rectificaciones no configuradas.')
  return client
}

function resultOrThrow<T>(data: T | null, error: { message: string } | null, fallback: string): T {
  if (error || data === null) throw new Error(error?.message ?? fallback)
  return data
}

export class SupabaseRectificationsRepository implements RectificationsRepository {
  public async rectifyCut(input: RectifyCutInput): Promise<RectificationResult> {
    const { data, error } = await clientOrThrow().rpc('rectify_cut', {
      p_cut_id: input.cutId,
      p_count_record_id: input.countRecordId,
      p_physical_payload: input.physicalPayload,
      p_reason: input.reason,
      p_request_id: input.requestId,
    })
    return resultOrThrow(data as RectificationResult | null, error, 'No fue posible crear la rectificación.')
  }

  public async rectifications(cutId: string, countRecordId?: string): Promise<CutRectification[]> {
    let query = clientOrThrow().from('cut_rectifications').select('id,cut_id,count_record_id,rectification_number,old_values,new_values,reason,created_at,created_by').eq('cut_id', cutId).order('rectification_number')
    if (countRecordId) query = query.eq('count_record_id', countRecordId)
    const { data, error } = await query
    if (error) throw new Error('No fue posible cargar rectificaciones autorizadas.')
    return (data ?? []) as CutRectification[]
  }

  public async artifacts(inventoryId: string, cutId?: string): Promise<ArtifactGeneration[]> {
    let query = clientOrThrow().from('artifact_generations').select('id,inventory_id,cut_id,rectification_id,artifact_type,scope,status,created_at,as_of_at,file_name,sha256,size_bytes,error_safe').eq('inventory_id', inventoryId).order('created_at')
    if (cutId) query = query.eq('cut_id', cutId)
    const { data, error } = await query
    if (error) throw new Error('No fue posible cargar evidencias autorizadas.')
    return (data ?? []) as ArtifactGeneration[]
  }

  public async generateArtifact(artifactGenerationId: string): Promise<void> {
    const { data, error } = await clientOrThrow().functions.invoke('generate-inventory-artifact', { body: { artifact_generation_id: artifactGenerationId } })
    if (error || data?.error) throw new Error(data?.error ?? error?.message ?? 'No fue posible procesar el artefacto.')
  }

  public async downloadArtifact(artifactGenerationId: string): Promise<{ signedUrl: string; fileName: string }> {
    const { data, error } = await clientOrThrow().functions.invoke('download-inventory-artifact', { body: { artifact_generation_id: artifactGenerationId } })
    if (error || data?.error || !data?.signedUrl || !data?.fileName) throw new Error(data?.error ?? error?.message ?? 'No fue posible preparar la descarga autorizada.')
    return { signedUrl: data.signedUrl, fileName: data.fileName }
  }

  public async masterItem(inventoryId: string, codigo: string): Promise<MasterItem | null> {
    const { data, error } = await clientOrThrow().from('inventory_master_items').select('codigo,descripcion,control_type').eq('inventory_id', inventoryId).eq('codigo', codigo.trim().toUpperCase()).maybeSingle()
    if (error) throw new Error('No fue posible consultar el maestro autorizado.')
    return data as MasterItem | null
  }
}
