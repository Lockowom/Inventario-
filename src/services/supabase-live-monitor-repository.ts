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

  /** CUT2-08: this RPC scopes both rows and aggregate-ready blocker fields on
   * the server. The browser never reconstructs foreign-warehouse findings. */
  public async findings(inventoryId: string) {
    const { data, error } = await clientOrThrow().rpc('get_live_monitor_findings', { p_inventory_id: inventoryId, p_limit: 100 })
    if (error) throw new Error('No fue posible cargar los hallazgos autorizados.')
    return (data ?? []) as Record<string, unknown>[]
  }

  public async findingDetail(findingId: string) {
    const { data, error } = await clientOrThrow().rpc('get_reference_finding_detail', { p_finding_id: findingId })
    if (error || !data) throw new Error('No fue posible cargar el detalle autorizado del hallazgo.')
    return data as Record<string, unknown>
  }

  public async findingActions(findingId: string) {
    const { data, error } = await clientOrThrow().rpc('get_my_reference_finding_actions', { p_finding_id: findingId })
    if (error || !data) throw new Error('No fue posible comprobar las acciones autorizadas.')
    return data as Record<string, boolean>
  }

  public async findingAssignees(findingId: string) {
    const { data, error } = await clientOrThrow().rpc('list_reference_finding_assignees', { p_finding_id: findingId })
    if (error) throw new Error('No fue posible cargar los responsables autorizados.')
    return (data ?? []) as Array<{ user_id: string; display_name: string }>
  }

  public async assignFinding(findingId: string, assigneeId: string) {
    const { error } = await clientOrThrow().rpc('assign_reference_finding', { p_finding_id: findingId, p_assigned_to: assigneeId })
    if (error) throw new Error(error.message)
  }

  public async resolveFinding(findingId: string, code: string, note: string) {
    const { error } = await clientOrThrow().rpc('resolve_reference_finding', { p_finding_id: findingId, p_resolution_code: code, p_resolution_note: note })
    if (error) throw new Error(error.message)
  }

  public async addFindingEvidence(findingId: string, note: string) {
    const { error } = await clientOrThrow().rpc('add_reference_finding_evidence', { p_finding_id: findingId, p_metadata: { note, source: 'MONITOR_UI' }, p_storage_path: null, p_sha256: null })
    if (error) throw new Error(error.message)
  }

  public async c2Execution(inventoryId: string) {
    const { data, error } = await clientOrThrow().rpc('get_c2_execution_metrics', { p_inventory_id: inventoryId })
    if (error || !data) throw new Error('No fue posible cargar la ejecución C2.')
    return data as Record<string, unknown>
  }

  /** The monitor is the authorized operational clock: it materializes overdue
   * C2 lifecycle events before reading the guarded dashboard projection. */
  public async processC2Sla(inventoryId: string) {
    const { error } = await clientOrThrow().rpc('process_recount_sla', { p_inventory_id: inventoryId })
    if (error) throw new Error('No fue posible actualizar el SLA operativo de C2.')
  }

  public async reassignC2(missionId: string, reason: string) {
    const { error } = await clientOrThrow().rpc('reassign_recount_mission', { p_mission_id: missionId, p_reason: reason })
    if (error) throw new Error(error.message)
  }

  public async c2OperationalMissions(inventoryId: string) {
    const { data, error } = await clientOrThrow().rpc('get_c2_operational_missions', { p_inventory_id: inventoryId })
    if (error) throw new Error('No fue posible cargar el estado SLA de C2.')
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
      .on('postgres_changes', { event: '*', schema: 'public', table: 'recount_missions', filter: `inventory_id=eq.${inventoryId}` }, refresh)
      .on('postgres_changes', { event: '*', schema: 'public', table: 'recount_mission_subtasks', filter: `inventory_id=eq.${inventoryId}` }, refresh)
      .on('postgres_changes', { event: '*', schema: 'public', table: 'inventory_system_reference_items', filter: `inventory_id=eq.${inventoryId}` }, refresh)
      .on('postgres_changes', { event: '*', schema: 'public', table: 'inventory_freeze_guards', filter: `inventory_id=eq.${inventoryId}` }, refresh)
      .on('postgres_changes', { event: '*', schema: 'public', table: 'inventories', filter: `id=eq.${inventoryId}` }, refresh)
      .subscribe((status) => onStatus(status === 'SUBSCRIBED' ? 'CONNECTED' : status === 'CHANNEL_ERROR' || status === 'TIMED_OUT' || status === 'CLOSED' ? 'DEGRADED' : 'DEGRADED'))
    return () => { void client.removeChannel(channel) }
  }
}
