import { useCallback, useEffect, useMemo, useState } from 'react'
import { SupabaseLiveMonitorRepository } from '../../services/supabase-live-monitor-repository'

const defaultMonitor = new SupabaseLiveMonitorRepository()
type Inventory = { id: string; name: string; status: string }
const resolutionCodes = ['CONFIRMED_PHYSICAL', 'SYSTEM_ERROR', 'DATA_ENTRY_ERROR', 'FOUND_IN_OTHER_LOCATION', 'FOUND_IN_OTHER_BATCH', 'FOUND_SERIAL', 'ADJUSTMENT_REQUIRED', 'NO_ADJUSTMENT_REQUIRED', 'DUPLICATE_RECORD', 'FALSE_POSITIVE', 'ESCALATED', 'RECTIFICATION_REQUIRED'] as const

/** Injection is DEV-fixture/test only; production keeps the guarded Supabase repository. */
export function LiveMonitorScreen({ repository }: { repository?: SupabaseLiveMonitorRepository } = {}) {
  const monitor = useMemo(() => repository ?? defaultMonitor, [repository])
  const [inventories, setInventories] = useState<Inventory[]>([])
  const [inventoryId, setInventoryId] = useState('')
  const [summary, setSummary] = useState<Record<string, unknown> | null>(null)
  const [coverage, setCoverage] = useState<Record<string, unknown>[]>([])
  const [activity, setActivity] = useState<Record<string, unknown>[]>([])
  const [missions, setMissions] = useState<Record<string, unknown>[]>([])
  const [findings, setFindings] = useState<Record<string, unknown>[]>([])
  const [findingDetail, setFindingDetail] = useState<Record<string, unknown> | null>(null)
  const [findingActions, setFindingActions] = useState<Record<string, boolean>>({})
  const [findingAssignees, setFindingAssignees] = useState<Array<{ user_id: string; display_name: string }>>([])
  const [c2Execution, setC2Execution] = useState<Record<string, unknown>>({})
  const [c2OperationalMissions, setC2OperationalMissions] = useState<Record<string, unknown>[]>([])
  const [otaDevices, setOtaDevices] = useState<Record<string, unknown>[]>([])
  const [coverageStatus, setCoverageStatus] = useState('TODOS')
  const [stage, setStage] = useState('TODOS')
  const [search, setSearch] = useState('')
  const [findingStatus, setFindingStatus] = useState('TODOS')
  const [findingSeverity, setFindingSeverity] = useState('TODAS')
  const [findingAssignment, setFindingAssignment] = useState('TODOS')
  const [findingsLoading, setFindingsLoading] = useState(false)
  const [message, setMessage] = useState('Cargando monitor autorizado…')
  const [realtime, setRealtime] = useState<'CONNECTING' | 'CONNECTED' | 'DEGRADED'>('CONNECTING')

  const selectedInventory = useMemo(() => inventories.find((item) => item.id === inventoryId), [inventories, inventoryId])
  useEffect(() => {
    void monitor.inventories().then((items) => {
      setInventories(items as Inventory[]); setInventoryId(items[0]?.id ?? '')
      setMessage(items.length ? '' : 'No existen inventarios autorizados para monitorizar.')
    }).catch((error: unknown) => setMessage(error instanceof Error ? error.message : 'Monitor no disponible.'))
  }, [monitor])

  const refresh = useCallback(async () => {
    if (!inventoryId) return
    try {
      setFindingsLoading(true)
      // SLA processing is independently server-authorized (REASSIGN_C2).
      // A read-only monitor user still receives the scoped read model below.
      if (typeof monitor.processC2Sla === 'function') await monitor.processC2Sla(inventoryId).catch(() => undefined)
      const [nextSummary, nextCoverage, nextActivity, nextMissions, nextFindings, nextOtaDevices, nextC2Execution, nextC2OperationalMissions] = await Promise.all([
        monitor.summary(inventoryId), monitor.coverage(inventoryId, coverageStatus, search), monitor.activity(inventoryId, stage, search), monitor.missions(inventoryId), typeof monitor.findings === 'function' ? monitor.findings(inventoryId) : Promise.resolve([]), monitor.otaDevices(), typeof monitor.c2Execution === 'function' ? monitor.c2Execution(inventoryId) : Promise.resolve({}), typeof monitor.c2OperationalMissions === 'function' ? monitor.c2OperationalMissions(inventoryId) : Promise.resolve([]),
      ])
      setSummary(nextSummary); setCoverage(nextCoverage); setActivity(nextActivity); setMissions(nextMissions); setFindings(nextFindings); setOtaDevices(nextOtaDevices); setC2Execution(nextC2Execution); setC2OperationalMissions(nextC2OperationalMissions); setMessage('')
    } catch (error: unknown) { setMessage(error instanceof Error ? error.message : 'Monitor no disponible.') } finally { setFindingsLoading(false) }
  }, [coverageStatus, inventoryId, monitor, search, stage])

  async function reassignC2(missionId: string) {
    const reason = window.prompt('Motivo de reasignación (mínimo 3 caracteres):')?.trim() ?? ''
    if (reason.length < 3) return
    try { await monitor.reassignC2(missionId, reason); await refresh() } catch (error) { setMessage(error instanceof Error ? error.message : 'No fue posible reasignar C2.') }
  }
  async function openFindingDetail(findingId: string) {
    try {
      const [detail, actions] = await Promise.all([monitor.findingDetail(findingId), monitor.findingActions(findingId)])
      const assignees = actions.assign ? await monitor.findingAssignees(findingId) : []
      setFindingDetail(detail); setFindingActions(actions); setFindingAssignees(assignees)
    } catch (error) { setMessage(error instanceof Error ? error.message : 'No fue posible abrir el hallazgo.') }
  }
  async function resolveFinding(code: string, note: string) {
    if (!findingDetail) return
    if (!resolutionCodes.includes(code as typeof resolutionCodes[number]) || !note.trim()) return
    try { await monitor.resolveFinding(String(findingDetail.id), code, note); await refresh(); await openFindingDetail(String(findingDetail.id)) } catch (error) { setMessage(error instanceof Error ? error.message : 'No fue posible resolver el hallazgo.') }
  }
  async function addFindingEvidence(note: string) {
    if (!findingDetail) return
    if (!note.trim()) return
    try { await monitor.addFindingEvidence(String(findingDetail.id), note); await refresh(); await openFindingDetail(String(findingDetail.id)) } catch (error) { setMessage(error instanceof Error ? error.message : 'No fue posible agregar evidencia.') }
  }
  async function assignFinding(assigneeId: string) {
    if (!findingDetail || !assigneeId) return
    try { await monitor.assignFinding(String(findingDetail.id), assigneeId); await refresh(); await openFindingDetail(String(findingDetail.id)) } catch (error) { setMessage(error instanceof Error ? error.message : 'No fue posible asignar el hallazgo.') }
  }

  useEffect(() => { void refresh() }, [refresh])

  useEffect(() => {
    if (!inventoryId || typeof monitor.subscribe !== 'function') return
    setRealtime('CONNECTING')
    return monitor.subscribe(inventoryId, () => { void refresh() }, (state) => setRealtime(state))
    // The channel carries invalidation only. It never becomes a second source of truth.
  }, [inventoryId, monitor, refresh])

  useEffect(() => {
    if (!inventoryId) return
    const timer = window.setInterval(() => { void refresh() }, 30_000)
    return () => window.clearInterval(timer)
    // The timer refreshes the protected server read model. It is not device presence.
  }, [inventoryId, refresh])

  const counts = objectOrEmpty(summary?.counts)
  const reference = objectOrEmpty(summary?.reference)
  const missionSummary = objectOrEmpty(summary?.missions)
  const devices = objectOrEmpty(summary?.devices)
  const monitorInventory = objectOrEmpty(summary?.inventory)
  const visibleFindings = findings.filter((finding) => {
    if (findingStatus !== 'TODOS' && String(finding.state) !== findingStatus) return false
    if (findingSeverity !== 'TODAS' && String(finding.severity) !== findingSeverity) return false
    if (findingAssignment === 'ASSIGNED' && !finding.assigned_to) return false
    if (findingAssignment === 'UNASSIGNED' && finding.assigned_to) return false
    return true
  })
  return <section className="live-monitor-screen" aria-labelledby="live-monitor-title">
    <header><p className="eyebrow">LIVE · operación y cobertura</p><h1 id="live-monitor-title">MONITOR OPERATIVO</h1><p>Lectura en vivo de evidencia recibida. Disponible es la única base de comparación; no se ejecutan ajustes de stock.</p><span className={`live-monitor-realtime live-monitor-realtime--${realtime.toLowerCase()}`}>{realtime === 'CONNECTED' ? 'EN VIVO' : realtime === 'CONNECTING' ? 'CONECTANDO EN VIVO…' : 'ACTUALIZACIÓN PROGRAMADA'}</span></header>
    <div className="live-monitor-actions"><label className="field"><span>Inventario</span><select value={inventoryId} onChange={(event) => setInventoryId(event.target.value)}>{inventories.map((item) => <option key={item.id} value={item.id}>{item.name} · {item.status}</option>)}</select></label><button className="button-secondary" type="button" onClick={() => void refresh()}>ACTUALIZAR</button></div>
    {selectedInventory?.status === 'ABIERTO' && !monitorInventory.c1_completed_at && <p className="live-monitor-note">C1 está abierto: una referencia Softland no visitada aún es cobertura pendiente, no un faltante.</p>}
    {message && <p className="form-warning" role="status">{message}</p>}
    <section className="live-monitor-metrics" aria-label="Resumen en vivo"><Metric label="Observaciones C1" value={counts.observations} /><Metric label="SKU contados" value={counts.counted_skus} /><Metric label="Unidades físicas C1" value={counts.counted_units} /><Metric label="Unidades Disponible" value={reference.available_units} /><Metric label="C2 en cola" value={c2Execution.queued_missions ?? missionSummary.c2_pending} /><Metric label="C2 reclamadas" value={c2Execution.claimed_missions} /><Metric label="C2 activas" value={c2Execution.active_missions} /><Metric label="C2 SLA vencidas" value={c2Execution.overdue_operational} /><Metric label="Reasignación C2" value={c2Execution.reassignment_pending} /><Metric label="Ubicaciones C2 pendientes" value={c2Execution.pending_subtasks} /><Metric label="Barridos de serie activos" value={c2Execution.serial_sweeps_active} /><Metric label="Excepciones C2" value={Number(c2Execution.blocked ?? 0) + Number(c2Execution.escalated ?? 0)} /><Metric label="C3 en curso" value={missionSummary.c3_active} /><Metric label="Físicos confirmados" value={missionSummary.physical_confirmed} /><Metric label="Pendientes sync" value={devices.pending_records} /></section>
    <section className="live-monitor-filter"><label className="field"><span>Buscar SKU, referencia o ubicación</span><input value={search} onChange={(event) => setSearch(event.target.value)} /></label><label className="field"><span>Estado de cobertura</span><select value={coverageStatus} onChange={(event) => setCoverageStatus(event.target.value)}><option value="TODOS">Todos</option><option value="CUBIERTA">Cubierta</option><option value="PENDIENTE_DE_COBERTURA">Pendiente de cobertura</option><option value="SERIE_SISTEMA_NO_CONTADA">Serie sistema no contada</option><option value="PARTIDA_SISTEMA_NO_CONTADA">Partida sistema no contada</option><option value="SERIE_FUERA_DE_DISPONIBLE">Serie fuera de disponible</option><option value="PARTIDA_FUERA_DE_DISPONIBLE">Partida fuera de disponible</option></select></label><label className="field"><span>Etapa de actividad</span><select value={stage} onChange={(event) => setStage(event.target.value)}><option value="TODOS">C1, C2 y C3</option><option value="C1">C1</option><option value="C2">C2</option><option value="C3">C3</option></select></label><button className="button-primary" type="button" onClick={() => void refresh()}>APLICAR FILTROS</button></section>
    <section className="live-monitor-section"><h2>Cobertura por SKU y referencia</h2><p>La identidad se conserva por serie o partida: dos filas con igual SKU no son duplicados si su referencia es distinta.</p><CoverageTable rows={coverage} /></section>
    <section className="live-monitor-section"><h2>Actividad de conteo</h2><ActivityList rows={activity} /></section>
    <section className="live-monitor-section"><h2>Misiones C2 / C3</h2><p>Estado real de cada misión, sus ubicaciones registradas y el caso que la originó.</p><MissionTable rows={missions} c2OperationalMissions={c2OperationalMissions} onReassign={reassignC2} /></section>
    <section className="live-monitor-section"><h2>Hallazgos operativos</h2><p>El listado es una proyección autorizada por bodega. Un hallazgo bloqueante no ajusta stock ni libera RP por sí mismo.</p><div className="live-monitor-filter" aria-label="Filtros de hallazgos"><label className="field"><span>Estado de hallazgo</span><select value={findingStatus} onChange={(event) => setFindingStatus(event.target.value)}><option value="TODOS">Todos</option><option value="OPEN">Abiertos</option><option value="HELD">En revisión</option><option value="RESOLVED">Resueltos</option><option value="DISCARDED">Descartados</option></select></label><label className="field"><span>Severidad</span><select value={findingSeverity} onChange={(event) => setFindingSeverity(event.target.value)}><option value="TODAS">Todas</option><option value="CRITICAL">Crítica</option><option value="HIGH">Alta</option><option value="MEDIUM">Media</option><option value="LOW">Baja</option><option value="INFO">Informativa</option></select></label><label className="field"><span>Responsable</span><select value={findingAssignment} onChange={(event) => setFindingAssignment(event.target.value)}><option value="TODOS">Todos</option><option value="ASSIGNED">Asignados</option><option value="UNASSIGNED">Sin asignar</option></select></label></div><FindingTable rows={visibleFindings} loading={findingsLoading} onDetail={openFindingDetail} />{findingDetail && <FindingDetail detail={findingDetail} actions={findingActions} assignees={findingAssignees} onClose={() => setFindingDetail(null)} onResolve={(code, note) => void resolveFinding(code, note)} onEvidence={(note) => void addFindingEvidence(note)} onAssign={(assigneeId) => void assignFinding(assigneeId)} />}</section>
    <section className="live-monitor-section"><h2>Dispositivos OTA · Android QA</h2><p>El servidor asigna <code>qa-beta</code> al registrar un dispositivo QA autenticado; el cliente no puede elegir ni cambiar canal.</p><OtaDeviceTable rows={otaDevices} /></section>
  </section>
}

function Metric({ label, value }: { label: string; value: unknown }) { return <article><span>{label}</span><strong>{value == null ? '—' : String(value)}</strong></article> }
function CoverageTable({ rows }: { rows: Record<string, unknown>[] }) { if (!rows.length) return <p>Sin referencias para los filtros actuales.</p>; return <div className="live-monitor-table"><table><thead><tr><th>SKU</th><th>Referencia</th><th>Disponible</th><th>Físico</th><th>Estado</th></tr></thead><tbody>{rows.map((row) => <tr key={`${row.codigo}-${row.reference_type}-${row.reference_value ?? ''}`}><td><strong>{String(row.codigo)}</strong><span>{String(row.descripcion)}</span></td><td>{String(row.reference_value ?? '—')}<span>{String(row.reference_type)}</span></td><td>{String(row.available_quantity)}</td><td>{String(row.physical_quantity)}</td><td><span className={`coverage-status coverage-status--${String(row.coverage_status).toLowerCase()}`}>{String(row.coverage_status).replaceAll('_', ' ')}</span></td></tr>)}</tbody></table></div> }
function ActivityList({ rows }: { rows: Record<string, unknown>[] }) { if (!rows.length) return <p>Sin actividad recibida para los filtros actuales.</p>; return <ul className="live-monitor-activity">{rows.map((row) => <li key={String(row.id)}><strong>{String(row.stage)} · {String(row.codigo)} · {String(row.cantidad_contada)}</strong><span>{String(row.display_name)} · {String(row.ubicacion)} · {formatDate(row.received_at)}</span><span>{row.serie ? `Serie ${String(row.serie)}` : row.partida ? `Partida ${String(row.partida)}` : 'SKU sin referencia controlada'}</span></li>)}</ul> }
function MissionTable({ rows, c2OperationalMissions, onReassign }: { rows: Record<string, unknown>[]; c2OperationalMissions: Record<string, unknown>[]; onReassign: (missionId: string) => void }) { if (!rows.length) return <p>No hay misiones C2/C3 para este inventario.</p>; const operational = new Map(c2OperationalMissions.map((item) => [String(item.mission_id), item])); return <div className="live-monitor-table"><table><thead><tr><th>Ronda</th><th>SKU / referencia</th><th>Estado</th><th>Responsable</th><th>Ubicaciones</th><th>Total</th><th>Acción</th></tr></thead><tbody>{rows.map((row) => { const state = operational.get(String(row.id)); const canReassign = state?.reassignable === true; const displayStatus = state?.sla_state === 'C2_OVERDUE_OPERATIONAL' ? 'C2 OVERDUE OPERATIONAL' : String(row.status); const c3Source = row.round === 3 ? `Origen C2 ${String(row.source_c2_mission_id ?? 'pendiente')} · ${String(row.c3_result ?? 'evidencia pendiente')}` : null; return <tr key={String(row.id)}><td>C{String(row.round)}</td><td><strong>{String(row.codigo)}</strong><span>{String(row.reference_value ?? 'SKU')}</span></td><td>{displayStatus}<span>{String(row.case_status)}</span>{c3Source && <span>{c3Source}</span>}</td><td>{String(row.assigned_display_name ?? 'En cola')}</td><td>{String(row.observation_count)}</td><td>{row.total_quantity == null ? '—' : String(row.total_quantity)}</td><td>{canReassign ? <button type="button" className="button-secondary" onClick={() => onReassign(String(row.id))}>REASIGNAR</button> : '—'}</td></tr> })}</tbody></table></div> }
function FindingTable({ rows, loading, onDetail }: { rows: Record<string, unknown>[]; loading: boolean; onDetail: (findingId: string) => void }) {
  if (loading) return <p role="status">Cargando hallazgos autorizados…</p>
  if (!rows.length) return <p>Sin hallazgos para los filtros y scope autorizados.</p>
  return <div className="live-monitor-table"><table><thead><tr><th>Severidad</th><th>Hallazgo / identidad</th><th>Origen</th><th>Estado</th><th>Bloqueos</th><th>Evidencia</th><th>Detalle</th></tr></thead><tbody>{rows.map((row) => {
    const blocks = [['SELLO', row.blocks_seal], ['RECONTEO', row.blocks_recount_completion], ['RP', row.blocks_rp], ['CIERRE', row.blocks_close]].filter(([, value]) => value === true).map(([label]) => label).join(' · ')
    return <tr key={String(row.id)}><td><strong>{String(row.severity)}</strong></td><td><strong>{String(row.finding_type).replaceAll('_', ' ')}</strong><span>{String(row.codigo || 'SKU')} · {String(row.reference_type)} · {String(row.normalized_reference_key)}</span><span>{String(row.description)}</span></td><td>{String(row.source_stage)}<span>{row.source_mission_id ? 'Misión de reconteo vinculada' : 'Sin misión'}</span></td><td>{String(row.state)}<span>{row.assigned_to ? 'Asignado' : 'Sin asignar'}</span></td><td>{blocks || 'No bloquea'}</td><td>{String(row.evidence_count)}<span>{formatDate(row.last_evidence_at)}</span></td><td><button type="button" className="button-secondary" onClick={() => onDetail(String(row.id))}>VER DETALLE</button></td></tr>
  })}</tbody></table></div>
}

function FindingDetail({ detail, actions, assignees, onClose, onResolve, onEvidence, onAssign }: { detail: Record<string, unknown>; actions: Record<string, boolean>; assignees: Array<{ user_id: string; display_name: string }>; onClose: () => void; onResolve: (code: string, note: string) => void; onEvidence: (note: string) => void; onAssign: (assigneeId: string) => void }) {
  const [evidenceNote, setEvidenceNote] = useState('')
  const [resolutionCode, setResolutionCode] = useState<typeof resolutionCodes[number] | ''>('')
  const [resolutionNote, setResolutionNote] = useState('')
  const evidence = Array.isArray(detail.evidence) ? detail.evidence as Record<string, unknown>[] : []
  const timeline = Array.isArray(detail.timeline) ? detail.timeline as Record<string, unknown>[] : []
  const blockers = objectOrEmpty(detail.blockers)
  const source = objectOrEmpty(detail.source_chain)
  const review = objectOrEmpty(detail.review_context)
  return <section className="finding-detail" aria-label="Detalle de hallazgo"><h3>Detalle de hallazgo</h3><p><strong>{String(detail.finding_type).replaceAll('_', ' ')}</strong> · {String(detail.severity)} · {String(detail.status)}</p><p>{String(detail.description)}</p><p>Identidad: {String(objectOrEmpty(detail.identity).normalized_reference_key ?? '—')} · Origen: {String(detail.source_stage)}</p><p>Inventario: {String(detail.inventory_name ?? '—')} · Bodega: {String(detail.warehouse_name ?? '—')}</p><p>Reportado por: {String(detail.reported_by_name ?? '—')} · {formatDate(detail.reported_at)} · Asignado: {String(detail.assigned_to_name ?? 'Sin asignar')}</p>{Object.keys(source).length > 0 && <p>Cadena: {source.mission_round ? 'C' + String(source.mission_round) : 'Sin misión'}{source.source_c2_mission_id ? ' · origen C2 vinculado' : ''}{source.source_cut_number ? ' · corte #' + String(source.source_cut_number) : ''}</p>}{Object.keys(review).length > 0 && <p className="form-warning">REVISIÓN REQUERIDA: {String(review.reason)}</p>}<p>Bloqueos: {Object.entries(blockers).filter(([, value]) => value === true).map(([name]) => name.toUpperCase()).join(' · ') || 'No bloquea'}</p>{Boolean(detail.resolution_code) && <p>Resolución histórica: {String(detail.resolution_code)} · {String(detail.resolution_note ?? '')} · {String(detail.resolved_by_name ?? '—')} · {formatDate(detail.resolved_at)}</p>}<h4>Evidencia</h4><ul>{evidence.map((item, index) => <li key={String(item.id ?? index)}>{formatDate(item.captured_at)} · {String(objectOrEmpty(item.metadata).note ?? 'Evidencia física')} · {String(item.captured_by_name ?? 'Autor autorizado')}</li>)}</ul><h4>Timeline</h4><ul>{timeline.map((item, index) => <li key={String(item.created_at) + '-' + String(index)}>{String(item.event_type)} · {formatDate(item.created_at)}{item.actor_name ? ' · ' + String(item.actor_name) : ''}</li>)}</ul><div>{actions.assign && assignees.length > 0 && <label>Asignar a <select aria-label="Asignar hallazgo" value={String(detail.assigned_to ?? '')} onChange={(event) => onAssign(event.target.value)}><option value="" disabled>Selecciona responsable</option>{assignees.map((assignee) => <option key={assignee.user_id} value={assignee.user_id}>{assignee.display_name}</option>)}</select></label>}{actions.add_evidence && <form onSubmit={(event) => { event.preventDefault(); if (evidenceNote.trim()) { onEvidence(evidenceNote.trim()); setEvidenceNote('') } }}><label className="field"><span>Nueva evidencia</span><textarea aria-label="Nueva evidencia" value={evidenceNote} onChange={(event) => setEvidenceNote(event.target.value)} /></label><button type="submit" className="button-secondary" disabled={!evidenceNote.trim()}>AGREGAR EVIDENCIA</button></form>}{actions.resolve && <form onSubmit={(event) => { event.preventDefault(); if (resolutionCode && resolutionNote.trim()) onResolve(resolutionCode, resolutionNote.trim()) }}><label className="field"><span>Decisión tipada</span><select aria-label="Decisión tipada" value={resolutionCode} onChange={(event) => setResolutionCode(event.target.value as typeof resolutionCodes[number] | '')}><option value="" disabled>Selecciona una decisión</option>{resolutionCodes.map((code) => <option key={code} value={code}>{code}</option>)}</select></label><label className="field"><span>Nota de resolución</span><textarea aria-label="Nota de resolución" value={resolutionNote} onChange={(event) => setResolutionNote(event.target.value)} /></label><button type="submit" className="button-primary" disabled={!resolutionCode || !resolutionNote.trim()}>RESOLVER CON DECISIÓN TIPADA</button></form>}<button type="button" className="button-secondary" onClick={onClose}>CERRAR DETALLE</button></div></section>
}
function OtaDeviceTable({ rows }: { rows: Record<string, unknown>[] }) { if (!rows.length) return <p>Aún no hay dispositivos OTA registrados.</p>; return <div className="live-monitor-table"><table><thead><tr><th>Usuario</th><th>Canal</th><th>APK</th><th>Bundle</th><th>Última señal</th><th>Estado</th></tr></thead><tbody>{rows.map((row) => <tr key={String(row.device_id)}><td>{String(row.display_name)}</td><td>{String(row.channel_name ?? 'SIN ASIGNAR')}</td><td>{String(row.native_version)}</td><td>{String(row.current_bundle_version ?? 'BASE')}</td><td>{formatDate(row.last_seen_at)}</td><td>{String(row.last_error_code ?? 'OK')}</td></tr>)}</tbody></table></div> }
function objectOrEmpty(value: unknown): Record<string, unknown> { return value && typeof value === 'object' && !Array.isArray(value) ? value as Record<string, unknown> : {} }
function formatDate(value: unknown) { return typeof value === 'string' ? new Date(value).toLocaleString() : 'Sin fecha' }
