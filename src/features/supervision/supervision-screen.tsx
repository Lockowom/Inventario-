import { useEffect, useMemo, useState } from 'react'
import { activityState, snapshotFilters, type SupervisionCursor, type SupervisionFilters } from '../../domain/supervision/contracts'
import { SupabaseSupervisionRepository } from '../../services/supabase-supervision-repository'
import { isSupabaseConfigured } from '../../services/supabase'
import { InventoryLifecyclePanel } from './inventory-lifecycle-panel'

const repository = new SupabaseSupervisionRepository()
type Inventory = { id: string; name: string; status: string }
type Profile = { role: 'CONTADOR' | 'ANALISTA' | 'ADMIN'; display_name: string }

export function SupervisionScreen() {
  const [inventories, setInventories] = useState<Inventory[]>([])
  const [profile, setProfile] = useState<Profile | null>(null)
  const [inventoryId, setInventoryId] = useState('')
  const [summary, setSummary] = useState<Record<string, unknown> | null>(null)
  const [rows, setRows] = useState<Record<string, unknown>[]>([])
  const [nextCursor, setNextCursor] = useState<SupervisionCursor | null>(null)
  const [draftFilters, setDraftFilters] = useState<SupervisionFilters>({})
  const [appliedFilters, setAppliedFilters] = useState<SupervisionFilters | null>(null)
  const [message, setMessage] = useState(isSupabaseConfigured ? 'Cargando supervisión autorizada…' : 'Supervisión no configurada.')

  const isManager = profile?.role === 'ANALISTA' || profile?.role === 'ADMIN'
  const selected = useMemo(() => inventories.find((item) => item.id === inventoryId), [inventories, inventoryId])
  useEffect(() => {
    if (!isSupabaseConfigured) return
    void Promise.all([repository.inventories(), repository.myProfile()]).then(([items, actor]) => { setInventories(items); setInventoryId(items[0]?.id ?? ''); setProfile(actor as Profile); setMessage(items.length ? '' : 'No existen inventarios autorizados.') }).catch((error: unknown) => setMessage(error instanceof Error ? error.message : 'Supervisión no disponible.'))
  }, [])
  useEffect(() => { if (!inventoryId || !profile) return; void refreshSummary() // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [inventoryId, profile?.role])
  useEffect(() => {
    if (!inventoryId || !profile) return
    const refreshTimer = window.setInterval(() => { void refreshSummary() }, 60_000)
    return () => window.clearInterval(refreshTimer)
    // The moderate timer exists only while this panel is mounted; it is not a presence heartbeat.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [inventoryId, profile?.role])

  async function refreshSummary() {
    try {
      const data = isManager ? await repository.supervision(inventoryId) : await repository.mine(inventoryId)
      setSummary(data); setMessage('')
    } catch (error: unknown) { setMessage(error instanceof Error ? error.message : 'Supervisión no disponible.') }
  }
  async function refreshLifecycleContext() {
    const items = await repository.inventories() as Inventory[]
    setInventories(items)
    if (!items.some((item) => item.id === inventoryId)) setInventoryId(items[0]?.id ?? '')
    await refreshSummary()
  }
  function selectInventory(nextInventoryId: string) {
    setInventoryId(nextInventoryId); setRows([]); setNextCursor(null); setAppliedFilters(null)
  }
  async function beginSearch() {
    try {
      const nextApplied = snapshotFilters(draftFilters)
      const found = await repository.search(inventoryId, nextApplied) as Record<string, unknown>[]
      setAppliedFilters(nextApplied); setRows(found)
      const last = found.at(-1)
      setNextCursor(found.length === 50 && last ? { capturedAt: String(last.captured_at), id: String(last.id) } : null)
      setMessage('')
    } catch (error: unknown) { setMessage(error instanceof Error ? error.message : 'Búsqueda no disponible.') }
  }
  async function loadMore() {
    if (!appliedFilters || !nextCursor) return
    try {
      const found = await repository.search(inventoryId, appliedFilters, nextCursor) as Record<string, unknown>[]
      setRows((current) => [...current, ...found])
      const last = found.at(-1)
      setNextCursor(found.length === 50 && last ? { capturedAt: String(last.captured_at), id: String(last.id) } : null)
      setMessage('')
    } catch (error: unknown) { setMessage(error instanceof Error ? error.message : 'Búsqueda no disponible.') }
  }
  const data = summary?.summary as Record<string, unknown> | undefined
  const counters = (summary?.counters as Record<string, unknown>[] | undefined) ?? []
  const devices = (summary?.devices as Record<string, unknown>[] | undefined) ?? []
  const duplicates = (summary?.possible_duplicate_serials as Record<string, unknown>[] | undefined) ?? []
  const mine = summary ?? {}

  return <section className="supervision-screen" aria-labelledby="supervision-title">
    <header><p className="eyebrow">Fase 5 · observación operacional</p><h1 id="supervision-title">SUPERVISIÓN</h1><p>Actividad recibida por servidor; “pendientes conocidos” no cubre dispositivos totalmente offline.</p></header>
    <div className="supervision-actions"><label className="field"><span>Inventario</span><select value={inventoryId} onChange={(event) => selectInventory(event.target.value)}>{inventories.map((item) => <option key={item.id} value={item.id}>{item.name} · {item.status}</option>)}</select></label><button className="button-secondary" type="button" onClick={() => void refreshSummary()}>ACTUALIZAR</button></div>
    {message && <p className="form-warning" role="status">{message}</p>}
    {isManager&&inventoryId&&<InventoryLifecyclePanel inventoryId={inventoryId} role={profile!.role as 'ANALISTA'|'ADMIN'} onChanged={refreshLifecycleContext}/>}
    {profile?.role === 'CONTADOR' ? <OwnSummary summary={mine} /> : <>
      <section className="supervision-summary" aria-label="Resumen de inventario"><Metric label="Conteos recibidos" value={data?.received_counts} /><Metric label="Unidades contadas" value={data?.counted_units} /><Metric label="Contadores asignados" value={data?.assigned_counters} /><Metric label="Dispositivos conocidos" value={data?.known_devices} /><Metric label="Pendientes conocidos" value={data?.known_pending} /><Metric label="Última recepción" value={formatDate(data?.last_received_at)} /></section>
      <h2>Estado de contadores</h2><div className="supervision-cards">{counters.map((counter) => <article key={String(counter.user_id)}><strong>{String(counter.display_name)}</strong><span>{String(counter.role)} · {counter.active ? 'ACTIVO' : 'INACTIVO'}</span><span>{activityState(stringOrNull(counter.last_seen_at))}</span><span>{String(counter.received_counts)} conteos · {String(counter.counted_units)} unidades</span><span>Última captura: {formatDate(counter.last_captured_at)}</span><span>Última recepción: {formatDate(counter.last_received_at)}</span><span>Pendientes conocidos: {String(counter.known_pending)}</span></article>)}</div>
      <h2>Dispositivos conocidos</h2><div className="supervision-cards">{devices.map((device) => <article key={String(device.id)}><strong>{String(device.platform)} · {String(device.app_version)}</strong><span>{activityState(stringOrNull(device.last_seen_at))}</span><span>Último sync: {formatDate(device.last_sync_at)}</span><span>Pendientes conocidos: {String(device.known_pending)}</span></article>)}</div>
      {duplicates.length > 0 && <section className="form-warning"><h2>Posible serie repetida</h2>{duplicates.map((item) => <p key={`${item.codigo}-${item.serie}`}>{String(item.codigo)} · {String(item.serie)} · {String(item.observations)} observaciones. Alerta no bloqueante.</p>)}</section>}
      <Search filters={draftFilters} setFilters={setDraftFilters} counters={counters} onSearch={beginSearch} /><SearchResults rows={rows} onMore={nextCursor && appliedFilters ? loadMore : undefined} />
    </>}
    {selected && <p className="supervision-note">Inventario {selected.status}: consulta de solo lectura.</p>}
  </section>
}
function Metric({ label, value }: { label: string; value: unknown }) { return <div><span>{label}</span><strong>{value === null || value === undefined ? '—' : String(value)}</strong></div> }
function OwnSummary({ summary }: { summary: Record<string, unknown> }) { return <section className="supervision-summary" aria-label="Resumen propio"><Metric label="Mis conteos" value={summary.received_counts} /><Metric label="Unidades contadas" value={summary.counted_units} /><Metric label="Pendientes conocidos" value={summary.pending_known} /><Metric label="Última captura" value={formatDate(summary.last_captured_at)} /><p>No se muestran stock, diferencias ni porcentaje de avance.</p></section> }
function Search({ filters, setFilters, counters, onSearch }: { filters: SupervisionFilters; setFilters: (next: SupervisionFilters) => void; counters: Record<string, unknown>[]; onSearch: () => Promise<void> }) { const update = (key: keyof SupervisionFilters, value: string) => setFilters({ ...filters, [key]: value }); return <section className="supervision-search"><h2>Búsqueda operacional</h2><div>{(['codigo', 'serie', 'partida', 'ubicacion'] as const).map((key) => <label className="field" key={key}><span>{key.toUpperCase()}</span><input value={filters[key] ?? ''} onChange={(event) => update(key, event.target.value)} /></label>)}<label className="field"><span>CONTADOR</span><select value={filters.userId ?? ''} onChange={(event) => update('userId', event.target.value)}><option value="">Todos los asignados</option>{counters.map((counter) => <option key={String(counter.user_id)} value={String(counter.user_id)}>{String(counter.display_name)}</option>)}</select></label><label className="field"><span>DESDE</span><input type="date" value={filters.capturedFrom ?? ''} onChange={(event) => update('capturedFrom', event.target.value)} /></label><label className="field"><span>HASTA</span><input type="date" value={filters.capturedTo ?? ''} onChange={(event) => update('capturedTo', event.target.value)} /></label></div><button className="button-primary" type="button" onClick={() => void onSearch()}>BUSCAR</button></section> }
function SearchResults({ rows, onMore }: { rows: Record<string, unknown>[]; onMore?: () => Promise<void> }) { return <section className="search-results"><h2>Conteos recibidos</h2>{rows.length === 0 ? <p>Sin resultados aún.</p> : <><ul>{rows.map((row) => <li key={String(row.id)}><strong>{String(row.codigo)} · {String(row.cantidad_contada)}</strong><span>{String(row.ubicacion)} · {String(row.display_name)}</span><span>Captura: {formatDate(row.captured_at)} · Recepción: {formatDate(row.received_at)} · Estado: {String(row.inventory_status_at_receive)}</span><span>{row.serie ? `Serie ${String(row.serie)}` : row.partida ? `Partida ${String(row.partida)}` : 'Sin serie/partida'}</span></li>)}</ul>{onMore && <button className="button-secondary" type="button" onClick={() => void onMore()}>CARGAR MÁS</button>}</>}</section> }
function stringOrNull(value: unknown) { return typeof value === 'string' ? value : null }
function formatDate(value: unknown) { return typeof value === 'string' ? new Date(value).toLocaleString() : 'Sin datos' }
