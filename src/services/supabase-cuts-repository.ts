import { getSupabaseClient } from './supabase'

function clientOrThrow() {
  const client = getSupabaseClient()
  if (!client) throw new Error('Cortes no configurados.')
  return client
}

export type PhysicalCorrection = {
  ubicacion: string
  codigo: string
  serie?: string
  partida?: string
  pieza_producto?: string
  fecha_vencimiento?: string
  talla?: string
  color?: string
  cantidad_contada: number
}

export class SupabaseCutsRepository {
  public async inventories() {
    const { data, error } = await clientOrThrow().from('inventories').select('id,name,status').order('name')
    if (error) throw new Error('No fue posible cargar inventarios autorizados.')
    return data ?? []
  }

  public async myProfile() {
    const client = clientOrThrow()
    const { data: auth } = await client.auth.getUser()
    if (!auth.user) throw new Error('Sesión requerida.')
    const { data, error } = await client.from('profiles').select('role,active').eq('user_id', auth.user.id).single()
    if (error || !data?.active) throw new Error('Perfil activo requerido.')
    return data
  }

  public async cuts(inventoryId: string) {
    const { data, error } = await clientOrThrow().rpc('list_inventory_cuts_v2', { p_inventory_id: inventoryId, p_limit: 50, p_before_cut_number: null })
    if (error) throw new Error('No fue posible cargar cortes autorizados.')
    return (data ?? []) as Record<string, unknown>[]
  }

  public async createCut(inventoryId: string, requestId: string) {
    const { data, error } = await clientOrThrow().rpc('create_cut', { p_inventory_id: inventoryId, p_request_id: requestId })
    if (error) throw new Error(error.message)
    return data as Record<string, unknown>
  }

  public async items(cutId: string, afterExportSeq: number | null = null) {
    const { data, error } = await clientOrThrow().rpc('get_cut_items', { p_cut_id: cutId, p_limit: 100, p_after_export_seq: afterExportSeq })
    if (error) throw new Error('No fue posible cargar el detalle inmutable del corte.')
    return (data ?? []) as Record<string, unknown>[]
  }

  public async correctionContext(countRecordId: string) {
    const { data, error } = await clientOrThrow().rpc('get_count_correction_context', { p_count_record_id: countRecordId })
    if (error || !data) throw new Error('No fue posible cargar el registro autorizado.')
    return data as Record<string, unknown>
  }

  public async correct(countRecordId: string, payload: PhysicalCorrection, reason: string) {
    const { data, error } = await clientOrThrow().rpc('correct_uncut_count', { p_count_record_id: countRecordId, p_physical_payload: payload, p_reason: reason })
    if (error) throw new Error(error.message)
    return data as Record<string, unknown>
  }

  public async generateRpXlsx(cutId: string, requestId: string) {
    const { data, error } = await clientOrThrow().functions.invoke('generate-cut-rp-xlsx', { body: { cutId, requestId } })
    if (error || data?.error) throw new Error(data?.error ?? error?.message ?? 'No fue posible generar el archivo RP.')
    return data as Record<string, unknown>
  }

  public async downloadRpXlsx(cutId: string) {
    const { data, error } = await clientOrThrow().functions.invoke('download-cut-rp-xlsx', { body: { cutId } })
    if (error || data?.error || !data?.signedUrl) throw new Error(data?.error ?? error?.message ?? 'No fue posible preparar la descarga RP.')
    return data as { signedUrl: string; fileName: string }
  }
}
