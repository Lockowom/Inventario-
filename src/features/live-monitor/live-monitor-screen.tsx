import { useCallback, useEffect, useMemo, useState } from 'react'
import { canAccessLiveMonitor } from '../../domain/live-monitor/contracts'
import type { AppRole } from '../../domain/auth/contracts'
import { SupabaseLiveMonitorRepository } from '../../services/supabase-live-monitor-repository'
import { SupabaseSupervisionRepository } from '../../services/supabase-supervision-repository'

const monitor = new SupabaseLiveMonitorRepository()
const supervision = new SupabaseSupervisionRepository()
type Inventory = { id: string; name: string; status: string }

export function LiveMonitorScreen() {
  const [role, setRole] = useState<AppRole | null>(null)
  const [inventories, setInventories] = useState<Inventory[]>([])
  const [inventoryId, setInventoryId] = useState('')
  const [summary, setSummary] = useState<Record<string, unknown> | null>(null)
  const [coverage, setCoverage] = useState<Record<string, unknown>[]>([])
  const [activity, setActivity] = useState<Record<string, unknown>[]>([])
  const [missions, setMissions] = useState<Record<string, unknown>[]>([])
  const [c2Execution, setC2Execution] = useState<Record<string, unknown>>({})
  const [otaDevices, setOtaDevices] = useState<Record<string, unknown>[]>([])
  const [coverageStatus, setCoverageStatus] = useState('TODOS')
  const [stage, setStage] = useState('TODOS')
  const [search, setSearch] = useState('')
  const [message, setMessage] = useState('Cargando monitor autorizado…')
  const [realtime, setRealtime] = useState<'CONNECTING' | 'CONNECTED' | 'DEGRADED'>('CONNECTING')

  const selectedInventory = useMemo(() => inventories.find((item) => item.id === inventoryId), [inventories, inventoryId])
  useEffect(() => {
    void Promise.all([supervision.myProfile(), monitor.inventories()]).then(([profile, items]) => {
      setRole(profile.role as AppRole); setInventories(items as Inventory[]); setInventoryId(items[0]?.id ?? '')
      setMessage(items.length ? '' : 'No existen inventarios autorizados para monitorizar.')
    }).catch((error: unknown) => setMessage(error instanceof Error ? error.message : 'Monitor no disponible.'))
  }, [])

  const refresh = useCallback(async () => {
    if (!inventoryId || !canAccessLiveMonitor(role)) return
    try {
      const [nextSummary, nextCoverage, nextActivity, nextMissions, nextOtaDevices, nextC2Execution] = await Promise.all([
        monitor.summary(inventoryId), monitor.coverage(inventoryId, coverageStatus, search), monitor.activity(inventoryId, stage, search), monitor.missions(inventoryId), monitor.otaDevices(), typeof monitor.c2Execution === 'function' ? monitor.c2Execution(inventoryId) : Promise.resolve({}),
      ])
      setSummary(nextSummary); setCoverage(nextCoverage); setActivity(nextActivity); setMissions(nextMissions); setOtaDevices(nextOtaDevices); setC2Execution(nextC2Execution); setMessage('')
    } catch (error: unknown) { setMessage(error instanceof Error ? error.message : 'Monitor no disponible.') }
  }, [coverageStatus, inventoryId, role, search, stage])

  useEffect(() => { void refresh() }, [refresh])

  useEffect(() => {
    if (!inventoryId || !canAccessLiveMonitor(role) || typeof monitor.subscribe !== 'function') return
    setRealtime('CONNECTING')
    return monitor.subscribe(inventoryId, () => { void refresh() }, (state) => setRealtime(state))
    // The channel carries invalidation only. It never becomes a second source of truth.
  }, [inventoryId, refresh, role])

  useEffect(() => {
    if (!inventoryId || !canAccessLiveMonitor(role)) return
    const timer = window.setInterval(() => { void refresh() }, 30_000)
    return () => window.clearInterval(timer)
    // The timer refreshes the protected server read model. It is not device presence.
  }, [inventoryId, refresh, role])

  if (role && !canAccessLiveMonitor(role)) return <section className="live-monitor-screen"><h1>MONITOR OPERATIVO</h1><p className="form-warning">Esta vista está disponible sólo para ANALISTA y ADMIN.</p></section>
  const counts = objectOrEmpty(summary?.counts)
  const reference = objectOrEmpty(summary?.reference)
  const missionSummary = objectOrEmpty(summary?.missions)
  const devices = objectOrEmpty(summary?.devices)
  const monitorInventory = objectOrEmpty(summary?.inventory)
  return <section className="live-monitor-screen" aria-labelledby="live-monitor-title">
    <header><p className="eyebrow">LIVE · operación y cobertura</p><h1 id="live-monitor-title">MONITOR OPERATIVO</h1><p>Lectura en vivo de evidencia recibida. Disponible es la única base de comparación; no se ejecutan ajustes de stock.</p><span className={`live-monitor-realtime live-monitor-realtime--${realtime.toLowerCase()}`}>{realtime === 'CONNECTED' ? 'EN VIVO' : realtime === 'CONNECTING' ? 'CONECTANDO EN VIVO…' : 'ACTUALIZACIÓN PROGRAMADA'}</span></header>
    <div className="live-monitor-actions"><label className="field"><span>Inventario</span><select value={inventoryId} onChange={(event) => setInventoryId(event.target.value)}>{inventories.map((item) => <option key={item.id} value={item.id}>{item.name} · {item.status}</option>)}</select></label><button className="button-secondary" type="button" onClick={() => void refresh()}>ACTUALIZAR</button></div>
    {selectedInventory?.status === 'ABIERTO' && !monitorInventory.c1_completed_at && <p className="live-monitor-note">C1 está abierto: una referencia Softland no visitada aún es cobertura pendiente, no un faltante.</p>}
    {message && <p className="form-warning" role="status">{message}</p>}
    <section className="live-monitor-metrics" aria-label="Resumen en vivo"><Metric label="Observaciones C1" value={counts.observations} /><Metric label="SKU contados" value={counts.counted_skus} /><Metric label="Unidades físicas C1" value={counts.counted_units} /><Metric label="Unidades Disponible" value={reference.available_units} /><Metric label="C2 en cola" value={c2Execution.queued_missions ?? missionSummary.c2_pending} /><Metric label="Ubicaciones C2 pendientes" value={c2Execution.pending_subtasks} /><Metric label="Barridos de serie activos" value={c2Execution.serial_sweeps_active} /><Metric label="Excepciones C2" value={Number(c2Execution.blocked ?? 0) + Number(c2Execution.escalated ?? 0)} /><Metric label="C3 en curso" value={missionSummary.c3_active} /><Metric label="Físicos confirmados" value={missionSummary.physical_confirmed} /><Metric label="Pendientes sync" value={devices.pending_records} /></section>
    <section className="live-monitor-filter"><label className="field"><span>Buscar SKU, referencia o ubicación</span><input value={search} onChange={(event) => setSearch(event.target.value)} /></label><label className="field"><span>Estado de cobertura</span><select value={coverageStatus} onChange={(event) => setCoverageStatus(event.target.value)}><option value="TODOS">Todos</option><option value="CUBIERTA">Cubierta</option><option value="PENDIENTE_DE_COBERTURA">Pendiente de cobertura</option><option value="SERIE_SISTEMA_NO_CONTADA">Serie sistema no contada</option><option value="PARTIDA_SISTEMA_NO_CONTADA">Partida sistema no contada</option><option value="SERIE_FUERA_DE_DISPONIBLE">Serie fuera de disponible</option><option value="PARTIDA_FUERA_DE_DISPONIBLE">Partida fuera de disponible</option></select></label><label className="field"><span>Etapa de actividad</span><select value={stage} onChange={(event) => setStage(event.target.value)}><option value="TODOS">C1, C2 y C3</option><option value="C1">C1</option><option value="C2">C2</option><option value="C3">C3</option></select></label><button className="button-primary" type="button" onClick={() => void refresh()}>APLICAR FILTROS</button></section>
    <section className="live-monitor-section"><h2>Cobertura por SKU y referencia</h2><p>La identidad se conserva por serie o partida: dos filas con igual SKU no son duplicados si su referencia es distinta.</p><CoverageTable rows={coverage} /></section>
    <section className="live-monitor-section"><h2>Actividad de conteo</h2><ActivityList rows={activity} /></section>
    <section className="live-monitor-section"><h2>Misiones C2 / C3</h2><p>Estado real de cada misión, sus ubicaciones registradas y el caso que la originó.</p><MissionTable rows={missions} /></section>
    <section className="live-monitor-section"><h2>Dispositivos OTA · Android QA</h2><p>El servidor asigna <code>qa-beta</code> al registrar un dispositivo QA autenticado; el cliente no puede elegir ni cambiar canal.</p><OtaDeviceTable rows={otaDevices} /></section>
  </section>
}

function Metric({ label, value }: { label: string; value: unknown }) { return <article><span>{label}</span><strong>{value == null ? '—' : String(value)}</strong></article> }
function CoverageTable({ rows }: { rows: Record<string, unknown>[] }) { if (!rows.length) return <p>Sin referencias para los filtros actuales.</p>; return <div className="live-monitor-table"><table><thead><tr><th>SKU</th><th>Referencia</th><th>Disponible</th><th>Físico</th><th>Estado</th></tr></thead><tbody>{rows.map((row) => <tr key={`${row.codigo}-${row.reference_type}-${row.reference_value ?? ''}`}><td><strong>{String(row.codigo)}</strong><span>{String(row.descripcion)}</span></td><td>{String(row.reference_value ?? '—')}<span>{String(row.reference_type)}</span></td><td>{String(row.available_quantity)}</td><td>{String(row.physical_quantity)}</td><td><span className={`coverage-status coverage-status--${String(row.coverage_status).toLowerCase()}`}>{String(row.coverage_status).replaceAll('_', ' ')}</span></td></tr>)}</tbody></table></div> }
function ActivityList({ rows }: { rows: Record<string, unknown>[] }) { if (!rows.length) return <p>Sin actividad recibida para los filtros actuales.</p>; return <ul className="live-monitor-activity">{rows.map((row) => <li key={String(row.id)}><strong>{String(row.stage)} · {String(row.codigo)} · {String(row.cantidad_contada)}</strong><span>{String(row.display_name)} · {String(row.ubicacion)} · {formatDate(row.received_at)}</span><span>{row.serie ? `Serie ${String(row.serie)}` : row.partida ? `Partida ${String(row.partida)}` : 'SKU sin referencia controlada'}</span></li>)}</ul> }
function MissionTable({ rows }: { rows: Record<string, unknown>[] }) { if (!rows.length) return <p>No hay misiones C2/C3 para este inventario.</p>; return <div className="live-monitor-table"><table><thead><tr><th>Ronda</th><th>SKU / referencia</th><th>Estado</th><th>Responsable</th><th>Ubicaciones</th><th>Total</th></tr></thead><tbody>{rows.map((row) => <tr key={String(row.id)}><td>C{String(row.round)}</td><td><strong>{String(row.codigo)}</strong><span>{String(row.reference_value ?? 'SKU')}</span></td><td>{String(row.status)}<span>{String(row.case_status)}</span></td><td>{String(row.assigned_display_name ?? 'En cola')}</td><td>{String(row.observation_count)}</td><td>{row.total_quantity == null ? '—' : String(row.total_quantity)}</td></tr>)}</tbody></table></div> }
function OtaDeviceTable({ rows }: { rows: Record<string, unknown>[] }) { if (!rows.length) return <p>Aún no hay dispositivos OTA registrados.</p>; return <div className="live-monitor-table"><table><thead><tr><th>Usuario</th><th>Canal</th><th>APK</th><th>Bundle</th><th>Última señal</th><th>Estado</th></tr></thead><tbody>{rows.map((row) => <tr key={String(row.device_id)}><td>{String(row.display_name)}</td><td>{String(row.channel_name ?? 'SIN ASIGNAR')}</td><td>{String(row.native_version)}</td><td>{String(row.current_bundle_version ?? 'BASE')}</td><td>{formatDate(row.last_seen_at)}</td><td>{String(row.last_error_code ?? 'OK')}</td></tr>)}</tbody></table></div> }
function objectOrEmpty(value: unknown): Record<string, unknown> { return value && typeof value === 'object' && !Array.isArray(value) ? value as Record<string, unknown> : {} }
function formatDate(value: unknown) { return typeof value === 'string' ? new Date(value).toLocaleString() : 'Sin fecha' }
