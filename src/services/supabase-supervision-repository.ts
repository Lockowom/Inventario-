import { localDateRangeToUtc, type SupervisionCursor, type SupervisionFilters } from '../domain/supervision/contracts'
import { getSupabaseClient } from './supabase'

function clientOrThrow() { const client = getSupabaseClient(); if (!client) throw new Error('Supervisión no configurada.') ; return client }

export class SupabaseSupervisionRepository {
  public async inventories() {
    const { data, error } = await clientOrThrow().from('inventories').select('id,name,status').order('name')
    if (error) throw new Error('No fue posible cargar inventarios autorizados.')
    return data ?? []
  }
  public async myProfile() {
    const client = clientOrThrow(); const { data: auth } = await client.auth.getUser(); if (!auth.user) throw new Error('Sesión requerida.')
    const { data, error } = await client.from('profiles').select('user_id,display_name,role,active').eq('user_id', auth.user.id).single()
    if (error || !data?.active) throw new Error('Perfil activo requerido.')
    return data
  }
  public async supervision(inventoryId: string) {
    const { data, error } = await clientOrThrow().rpc('get_inventory_supervision', { p_inventory_id: inventoryId })
    if (error || !data) throw new Error('No fue posible cargar supervisión autorizada.')
    return data as Record<string, unknown>
  }
  public async mine(inventoryId: string) {
    const { data, error } = await clientOrThrow().rpc('get_my_count_summary', { p_inventory_id: inventoryId })
    if (error || !data) throw new Error('No fue posible cargar el resumen propio.')
    return data as Record<string, unknown>
  }
  public async search(inventoryId: string, filters: SupervisionFilters, cursor?: SupervisionCursor) {
    const range = localDateRangeToUtc(filters)
    const { data, error } = await clientOrThrow().rpc('search_inventory_counts', {
      p_inventory_id: inventoryId, p_limit: 50, p_cursor_captured_at: cursor?.capturedAt ?? null, p_cursor_id: cursor?.id ?? null,
      p_user_id: filters.userId || null, p_codigo: filters.codigo || null, p_serie: filters.serie || null, p_partida: filters.partida || null, p_ubicacion: filters.ubicacion || null,
      p_captured_from: range.capturedFrom, p_captured_to_exclusive: range.capturedToExclusive,
    })
    if (error) throw new Error('Búsqueda no disponible para este inventario.')
    return data ?? []
  }
}
