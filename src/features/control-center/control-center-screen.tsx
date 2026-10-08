import { useCallback, useEffect, useMemo, useState } from 'react'
import type { AppRole } from '../../domain/auth/contracts'
import { SupabaseLiveMonitorRepository } from '../../services/supabase-live-monitor-repository'
import { SupabaseReconciliationRepository, type LiveReconciliationWorkspace, type ReconciliationRow, type ReconciliationSummary } from '../../services/supabase-reconciliation-repository'
import { InventoryLifecyclePanel } from '../supervision/inventory-lifecycle-panel'
import { useRequiredActiveInventory } from './active-inventory-context'
import { useSwipe } from '../../ui/gestures/use-gestures'
import { useKeyboardShortcuts } from '../../ui/shortcuts/use-keyboard-shortcuts'
import { useExperiencePreferences } from '../../ui/preferences/experience-preferences'

type ControlCenterTab = 'RESUMEN' | 'ACTIVIDAD' | 'COBERTURA' | 'EQUIPO' | 'DIFERENCIAS' | 'C2_C3' | 'DICTAMEN' | 'HISTORIAL'
const tabs: ReadonlyArray<{ id: ControlCenterTab; label: string }> = [
  { id: 'RESUMEN', label: 'Resumen' }, { id: 'ACTIVIDAD', label: 'Actividad' }, { id: 'COBERTURA', label: 'Cobertura' }, { id: 'EQUIPO', label: 'Equipo y dispositivos' },
  { id: 'DIFERENCIAS', label: 'Diferencias' }, { id: 'C2_C3', label: 'C2 / C3' }, { id: 'DICTAMEN', label: 'Dictamen y ajustes' }, { id: 'HISTORIAL', label: 'Historial' },
]
const monitor = new SupabaseLiveMonitorRepository()
const reconciliation = new SupabaseReconciliationRepository()

export function ControlCenterScreen({ role }: { role: AppRole | null }) {
  const { inventories, inventoryId, activeInventory, loading: inventoriesLoading, error: inventoryError, selectInventory } = useRequiredActiveInventory()
  const { preferences } = useExperiencePreferences()
  const [tab, setTab] = useState<ControlCenterTab>('RESUMEN')
  const [message, setMessage] = useState('')
  const [loading, setLoading] = useState(false)
  const [summary, setSummary] = useState<Record<string, unknown> | null>(null)
  const [reconciliationSummary, setReconciliationSummary] = useState<ReconciliationSummary | null>(null)
  const [rows, setRows] = useState<Record<string, unknown>[]>([])
  const [cases, setCases] = useState<ReconciliationRow[]>([])
  const [workspace, setWorkspace] = useState<LiveReconciliationWorkspace | null>(null)
  const [refreshedAt, setRefreshedAt] = useState<Date | null>(null)
  const [realtime, setRealtime] = useState<'LIVE' | 'RECONNECTING'>('RECONNECTING')
  const manager = role === 'ANALISTA' || role === 'ADMIN'

  const refresh = useCallback(async () => {
    if (!inventoryId || !manager) return
    setLoading(true)
    try {
      if (tab === 'RESUMEN' || tab === 'HISTORIAL') {
        const [nextSummary, nextReconciliation] = await Promise.all([monitor.summary(inventoryId), reconciliation.summary(inventoryId)])
        setSummary(nextSummary); setReconciliationSummary(nextReconciliation)
      } else if (tab === 'ACTIVIDAD') setRows(await monitor.activity(inventoryId))
      else if (tab === 'COBERTURA') setRows(await monitor.coverage(inventoryId))
      else if (tab === 'EQUIPO') setRows(await monitor.otaDevices())
      else if (tab === 'C2_C3') setRows(await monitor.missions(inventoryId))
      else if (tab === 'DIFERENCIAS') setWorkspace(await reconciliation.liveWorkspace(inventoryId))
      else setCases(await reconciliation.list(inventoryId))
      setMessage('')
      setRefreshedAt(new Date())
    } catch (cause: unknown) {
      setMessage(cause instanceof Error ? cause.message : 'No fue posible actualizar el Centro de Control.')
    } finally { setLoading(false) }
  }, [inventoryId, manager, tab])

  useEffect(() => { void refresh() }, [refresh])
  useEffect(() => {
    if (!inventoryId || !manager) return
    setRealtime('LIVE')
    return monitor.subscribe(inventoryId, () => { setRealtime('LIVE'); void refresh() }, () => setRealtime('RECONNECTING'))
    // Realtime is intentionally an invalidation signal only; all state is re-read from guarded RPCs.
  }, [inventoryId, manager, refresh])

  const title = useMemo(() => activeInventory ? `${activeInventory.name} · ${activeInventory.status}` : 'Sin inventario seleccionado', [activeInventory])
  const moveTab = useCallback((direction: -1 | 1) => setTab((current) => {
    const index = tabs.findIndex((item) => item.id === current)
    return tabs[(index + direction + tabs.length) % tabs.length]?.id ?? current
  }), [])
  const touchNavigation = useSwipe({ enabled: preferences.gestures, onSwipeLeft: () => moveTab(1), onSwipeRight: () => moveTab(-1) })
  useKeyboardShortcuts([
    { key: 'r', handler: () => void refresh(), enabled: manager && Boolean(inventoryId) },
    ...tabs.map((item, index) => ({ key: String(index + 1), handler: () => setTab(item.id), enabled: manager })),
  ])
  if (!manager) return <section className="control-center-screen"><h1>CENTRO DE CONTROL DE INVENTARIO</h1><p className="form-warning">Esta vista está disponible sólo para ANALISTA y ADMIN.</p></section>

  return <section className="control-center-screen" aria-labelledby="control-center-title" {...touchNavigation}>
    <header><p className="eyebrow">CONTROL OPERATIVO · lectura protegida</p><h1 id="control-center-title">CENTRO DE CONTROL DE INVENTARIO</h1><p>Una sola vista para cobertura, actividad, conciliación y ciclos C1/C2/C3. Disponible es la base de comparación; no se ejecutan ajustes automáticos en Softland.</p><span className={realtime === 'LIVE' ? 'control-center__realtime control-center__realtime--live' : 'control-center__realtime'}>● {realtime === 'LIVE' ? 'EN VIVO' : 'ACTUALIZACIÓN PROGRAMADA'}</span></header>
    <div className="control-center__context">
      <label className="field"><span>Inventario activo</span><select value={inventoryId} disabled={inventoriesLoading} onChange={(event) => selectInventory(event.target.value)}>{inventories.map((inventory) => <option key={inventory.id} value={inventory.id}>{inventory.name} · {inventory.status}</option>)}</select></label>
      <div><strong>{title}</strong><span>{refreshedAt ? `Actualizado ${refreshedAt.toLocaleString()}` : 'Esperando lectura protegida…'}</span></div>
      <button className="button-secondary" type="button" disabled={loading || !inventoryId} onClick={() => void refresh()}>{loading ? 'ACTUALIZANDO…' : 'ACTUALIZAR'}</button>
    </div>
    {inventoryError && <p className="form-warning" role="status">{inventoryError}</p>}
    {message && <p className="form-warning" role="status">{message}</p>}
    {!inventoriesLoading && !inventoryId && !inventoryError && <p className="form-warning">No hay inventarios autorizados para este usuario.</p>}
    <div className="control-center__tabs" role="tablist" aria-label="Secciones del Centro de Control">{tabs.map((item) => <button key={item.id} id={`control-tab-${item.id}`} type="button" role="tab" aria-selected={tab === item.id} aria-controls="control-center-panel" className={tab === item.id ? 'is-active' : ''} onClick={() => setTab(item.id)}>{item.label}</button>)}</div>
    <div id="control-center-panel" role="tabpanel" aria-labelledby={`control-tab-${tab}`} className="control-center__panel" key={tab}>
      {tab === 'RESUMEN' && <SummaryPanel inventoryId={inventoryId} role={role} summary={summary} reconciliationSummary={reconciliationSummary} onChanged={refresh} />}
      {tab === 'ACTIVIDAD' && <ActivityPanel rows={rows} />}
      {tab === 'COBERTURA' && <CoveragePanel rows={rows} />}
      {tab === 'EQUIPO' && <DevicePanel rows={rows} />}
      {tab === 'DIFERENCIAS' && <DifferencePanel workspace={workspace} />}
      {tab === 'C2_C3' && <MissionPanel rows={rows} />}
      {tab === 'DICTAMEN' && <CasesPanel rows={cases} />}
      {tab === 'HISTORIAL' && <HistoryPanel reconciliationSummary={reconciliationSummary} refreshedAt={refreshedAt} />}
    </div>
  </section>
}

function SummaryPanel({ inventoryId, role, summary, reconciliationSummary, onChanged }: { inventoryId: string; role: 'ANALISTA' | 'ADMIN'; summary: Record<string, unknown> | null; reconciliationSummary: ReconciliationSummary | null; onChanged: () => Promise<void> }) {
  const counts = object(summary?.counts); const reference = object(summary?.reference); const missions = object(summary?.missions)
  return <><section className="control-center__metrics" aria-label="Resumen operativo"><Metric label="Observaciones C1" value={counts.observations} /><Metric label="SKU contados" value={counts.counted_skus} /><Metric label="Unidades físicas C1" value={counts.counted_units} /><Metric label="Unidades Disponible" value={reference.available_units} /><Metric label="C2 en cola" value={missions.c2_pending} /><Metric label="C3 en curso" value={missions.c3_active} /><Metric label="Casos abiertos" value={reconciliationSummary?.summary.open} /><Metric label="Resueltos" value={reconciliationSummary?.summary.resolved} /></section>{inventoryId && <InventoryLifecyclePanel inventoryId={inventoryId} role={role} onChanged={onChanged} />}</>
}
function ActivityPanel({ rows }: { rows: Record<string, unknown>[] }) { return <section><h2>ACTIVIDAD DE CONTEO</h2><p>Eventos recibidos de C1, C2 y C3. No representa presencia en línea.</p><SimpleList rows={rows} line={(row) => `${String(row.stage)} · ${String(row.codigo)} · ${String(row.cantidad_contada)}`} detail={(row) => `${String(row.display_name)} · ${String(row.ubicacion)} · ${formatDate(row.received_at)}`} empty="Sin actividad recibida para este inventario." /></section> }
function CoveragePanel({ rows }: { rows: Record<string, unknown>[] }) { return <section><h2>COBERTURA</h2><p>Una referencia no visitada durante C1 permanece pendiente; no es faltante hasta finalizar C1.</p><table className="control-center__table"><thead><tr><th>SKU</th><th>Referencia</th><th>Disponible</th><th>Físico</th><th>Estado</th></tr></thead><tbody>{rows.map((row) => <tr key={`${row.codigo}-${row.reference_type}-${row.reference_value ?? ''}`}><td>{String(row.codigo)}<small>{String(row.descripcion)}</small></td><td>{String(row.reference_value ?? '—')}<small>{String(row.reference_type)}</small></td><td>{String(row.available_quantity)}</td><td>{String(row.physical_quantity)}</td><td>{String(row.coverage_status).replaceAll('_', ' ')}</td></tr>)}</tbody></table>{!rows.length && <p>Sin referencias para este inventario.</p>}</section> }
function DevicePanel({ rows }: { rows: Record<string, unknown>[] }) { return <section><h2>EQUIPO Y DISPOSITIVOS</h2><p>Señales OTA de Android QA. El canal lo asigna el servidor; el dispositivo no elige canal.</p><SimpleList rows={rows} line={(row) => `${String(row.display_name)} · ${String(row.channel_name ?? 'SIN ASIGNAR')}`} detail={(row) => `APK ${String(row.native_version)} · Bundle ${String(row.current_bundle_version ?? 'BASE')} · ${formatDate(row.last_seen_at)}`} empty="Aún no hay dispositivos OTA registrados." /></section> }
function DifferencePanel({ workspace }: { workspace: LiveReconciliationWorkspace | null }) { return <section><h2>DIFERENCIAS</h2><p>Vista de comparación en vivo. Es evidencia para investigar, no una instrucción de ajuste.</p>{workspace && <><section className="control-center__metrics"><Metric label="SKU totales" value={workspace.metrics.total_skus} /><Metric label="Cuadrados" value={workspace.metrics.matched_items} /><Metric label="Con diferencia" value={workspace.metrics.difference_items} /><Metric label="Nuevas referencias" value={workspace.metrics.new_references} /><Metric label="Fuera de disponible" value={workspace.metrics.non_available_items} /></section><table className="control-center__table"><thead><tr><th>SKU</th><th>Referencia</th><th>Disponible</th><th>Físico</th><th>Diferencia</th><th>Estado</th></tr></thead><tbody>{workspace.rows.map((row) => <tr key={`${row.codigo}-${row.reference_type}-${row.reference_value ?? ''}`}><td>{row.codigo}<small>{row.descripcion}</small></td><td>{row.reference_value ?? '—'}<small>{row.reference_type}</small></td><td>{row.available_quantity}</td><td>{row.counted_quantity}</td><td>{row.difference_quantity}</td><td>{row.status.replaceAll('_', ' ')}</td></tr>)}</tbody></table></>}</section> }
function MissionPanel({ rows }: { rows: Record<string, unknown>[] }) { return <section><h2>MISIONES C2 / C3</h2><p>Reconteos ciegos: esta vista muestra el estado, no adelanta cantidades al contador.</p><SimpleList rows={rows} line={(row) => `C${String(row.round)} · ${String(row.codigo)} · ${String(row.status)}`} detail={(row) => `${String(row.assigned_display_name ?? 'En cola')} · ${String(row.observation_count)} ubicaciones · Total ${row.total_quantity == null ? '—' : String(row.total_quantity)}`} empty="No hay misiones C2/C3 para este inventario." /></section> }
function CasesPanel({ rows }: { rows: ReconciliationRow[] }) { return <section><h2>DICTAMEN Y AJUSTES</h2><p>Los dictámenes quedan trazables; ningún resultado ejecuta ajustes automáticos de stock.</p>{rows.length ? <ul className="control-center__list">{rows.map((row) => <li key={row.id}><strong>{row.codigo} · {row.anomaly_type.replaceAll('_', ' ')} · {row.status.replaceAll('_', ' ')}</strong><span>Softland {row.system_quantity} · físico {row.confirmed_physical_quantity ?? row.physical_quantity} · {row.reference_value ?? 'sin referencia'}</span></li>)}</ul> : <p>No hay casos de conciliación para este inventario.</p>}</section> }
function HistoryPanel({ reconciliationSummary, refreshedAt }: { reconciliationSummary: ReconciliationSummary | null; refreshedAt: Date | null }) { return <section><h2>HISTORIAL</h2><p>La evidencia detallada vive en los casos, misiones y cortes inmutables; este resumen no borra ni reescribe eventos.</p><dl className="control-center__history"><div><dt>Referencia Softland</dt><dd>{reconciliationSummary?.source_reference ? `v${reconciliationSummary.source_reference.reference_version} · ${reconciliationSummary.source_reference.row_count} filas` : 'Aún no cargada'}</dd></div><div><dt>Última materialización</dt><dd>{formatDate(reconciliationSummary?.last_materialized_at)}</dd></div><div><dt>Última lectura del centro</dt><dd>{refreshedAt ? refreshedAt.toLocaleString() : '—'}</dd></div></dl></section> }
function SimpleList({ rows, line, detail, empty }: { rows: Record<string, unknown>[]; line: (row: Record<string, unknown>) => string; detail: (row: Record<string, unknown>) => string; empty: string }) { return rows.length ? <ul className="control-center__list">{rows.map((row, index) => <li key={String(row.id ?? row.device_id ?? `${index}-${line(row)}`)}><strong>{line(row)}</strong><span>{detail(row)}</span></li>)}</ul> : <p>{empty}</p> }
function Metric({ label, value }: { label: string; value: unknown }) { const display = value == null ? '—' : String(value); return <article><span>{label}</span><strong key={display}>{display}</strong></article> }
function object(value: unknown): Record<string, unknown> { return value && typeof value === 'object' && !Array.isArray(value) ? value as Record<string, unknown> : {} }
function formatDate(value: unknown) { return typeof value === 'string' ? new Date(value).toLocaleString() : 'Sin fecha' }
