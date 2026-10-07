import { getSupabaseClient } from './supabase'

function clientOrThrow() {
  const client = getSupabaseClient()
  if (!client) throw new Error('Monitor no configurado.')
  return client
}

export class SupabaseLiveMonitorRepository {
  public async inventories() {
    const { data, error } = await clientOrThrow().from('inventories').select('id,name,status').order('name')
    if (error) throw new Error('No fue posible cargar inventarios autorizados.')
    return data ?? []
  }

  public async summary(inventoryId: string) {
    const { data, error } = await clientOrThrow().rpc('get_live_monitor_summary', { p_inventory_id: inventoryId })
    if (error || !data) throw new Error('No fue posible cargar el monitor operativo.')
    return data as Record<string, unknown>
  }

  public async coverage(inventoryId: string, status = 'TODOS', search = '') {
    const { data, error } = await clientOrThrow().rpc('get_live_monitor_coverage', {
      p_inventory_id: inventoryId, p_status: status, p_search: search || null, p_limit: 100, p_offset: 0,
    })
    if (error) throw new Error('No fue posible cargar la cobertura de referencias.')
    return (data ?? []) as Record<string, unknown>[]
  }

  public async activity(inventoryId: string, stage = 'TODOS', search = '') {
    const { data, error } = await clientOrThrow().rpc('get_live_monitor_activity', {
      p_inventory_id: inventoryId, p_limit: 50, p_cursor_received_at: null, p_cursor_id: null, p_stage: stage, p_search: search || null,
    })
    if (error) throw new Error('No fue posible cargar la actividad de conteo.')
    return (data ?? []) as Record<string, unknown>[]
  }

  public async missions(inventoryId: string) {
    const { data, error } = await clientOrThrow().rpc('get_live_monitor_missions', { p_inventory_id: inventoryId, p_limit: 100 })
    if (error) throw new Error('No fue posible cargar las misiones de reconteo.')
    return (data ?? []) as Record<string, unknown>[]
  }

  public async otaDevices() {
    const { data, error } = await clientOrThrow().rpc('get_live_monitor_ota_devices', { p_limit: 100 })
    if (error) throw new Error('No fue posible cargar los dispositivos OTA.')
    return (data ?? []) as Record<string, unknown>[]
  }

  /** Events are only invalidation signals; canonical data always comes from the guarded RPCs. */
  public subscribe(inventoryId: string, onChange: () => void, onStatus: (state: 'CONNECTED' | 'DEGRADED') => void) {
    const client = clientOrThrow()
    const refresh = () => onChange()
    const channel = client.channel(`live-monitor:${inventoryId}`)
      .on('postgres_changes', { event: '*', schema: 'public', table: 'count_records', filter: `inventory_id=eq.${inventoryId}` }, refresh)
      .on('postgres_changes', { event: '*', schema: 'public', table: 'reconciliation_cases', filter: `inventory_id=eq.${inventoryId}` }, refresh)
      .on('postgres_changes', { event: '*', schema: 'public', table: 'inventory_system_reference_items', filter: `inventory_id=eq.${inventoryId}` }, refresh)
      .on('postgres_changes', { event: '*', schema: 'public', table: 'inventory_freeze_guards', filter: `inventory_id=eq.${inventoryId}` }, refresh)
      .on('postgres_changes', { event: '*', schema: 'public', table: 'inventories', filter: `id=eq.${inventoryId}` }, refresh)
      .subscribe((status) => onStatus(status === 'SUBSCRIBED' ? 'CONNECTED' : status === 'CHANNEL_ERROR' || status === 'TIMED_OUT' || status === 'CLOSED' ? 'DEGRADED' : 'DEGRADED'))
    return () => { void client.removeChannel(channel) }
  }
}
