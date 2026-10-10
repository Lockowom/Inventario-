import { useCallback, useEffect, useMemo, useState } from 'react'
import type { CaptureGate } from '../counting/counting-screen'
import { SupabaseReconciliationRepository, type RecountFindingType, type RecountMission, type RecountSubtask } from '../../services/supabase-reconciliation-repository'
import { SupabaseSupervisionRepository } from '../../services/supabase-supervision-repository'
import { recountOfflineOutbox } from './recount-offline-outbox'
import { OperationalFeedback, type FeedbackTone } from '../../ui/feedback/operational-feedback'
import { interactionSounds } from '../../ui/sound/interaction-sound-service'
import { sortExecutionLocations } from '../../domain/reconciliation/c2-2-algorithm'

type Inventory = { id: string; name: string; status: string }
type Profile = { user_id: string; display_name: string; role: 'CONTADOR' | 'ANALISTA' | 'ADMIN'; active: boolean }
const reconciliation = new SupabaseReconciliationRepository()
const supervision = new SupabaseSupervisionRepository()
const FINDINGS: RecountFindingType[] = ['DAMAGED', 'EXPIRED', 'ILLEGIBLE_SERIAL', 'ILLEGIBLE_BATCH', 'WRONG_LOCATION', 'WRONG_LABEL', 'DUPLICATE_PHYSICAL_LABEL', 'OTHER']

export function RecountQueueScreen({ captureGate }: { captureGate?: CaptureGate }) {
  const [profile, setProfile] = useState<Profile | null>(null)
  const [inventories, setInventories] = useState<Inventory[]>([])
  const [inventoryId, setInventoryId] = useState('')
  const [mission, setMission] = useState<RecountMission | null>(null)
  const [queued, setQueued] = useState(0)
  const [round, setRound] = useState<2 | 3 | null>(null)
  const [selectedSubtaskId, setSelectedSubtaskId] = useState('')
  const [serial, setSerial] = useState('')
  const [batch, setBatch] = useState('')
  const [quantity, setQuantity] = useState('')
  const [foundLocation, setFoundLocation] = useState('')
  const [reason, setReason] = useState('')
  const [finding, setFinding] = useState<RecountFindingType>('OTHER')
  const [findingNote, setFindingNote] = useState('')
  const [busy, setBusy] = useState(false)
  const [message, setMessage] = useState('Cargando contexto de reconteos…')
  const [feedback, setFeedback] = useState<{ tone: FeedbackTone; message: string }>({ tone: 'IDLE', message: '' })
  const selectedInventory = useMemo(() => inventories.find((item) => item.id === inventoryId) ?? null, [inventories, inventoryId])
  const subtasks = useMemo(() => mission ? [...(mission.subtasks ?? [])].sort((left, right) => locationOrder(left, right)) : [], [mission])
  const selectedSubtask = useMemo(() => subtasks.find((item) => item.id === selectedSubtaskId) ?? subtasks.find((item) => item.status === 'ACTIVE' || item.status === 'PENDING') ?? null, [subtasks, selectedSubtaskId])
  const blocked = Boolean(captureGate?.blocked)

  const assignMission = (next: RecountMission | null) => {
    setMission(next); recountOfflineOutbox.cacheMission(next)
    const nextSubtasks = next?.subtasks ?? []
    setSelectedSubtaskId((current) => nextSubtasks.some((subtask) => subtask.id === current) ? current : (nextSubtasks.find((subtask) => subtask.status === 'ACTIVE' || subtask.status === 'PENDING')?.id ?? ''))
  }

  useEffect(() => {
    let active = true
    void Promise.all([supervision.myProfile(), supervision.inventories()]).then(([nextProfile, rows]) => {
      if (!active) return
      const open = (rows as Inventory[]).filter((item) => item.status === 'ABIERTO')
      setProfile(nextProfile as Profile); setInventories(open); setInventoryId((current) => current || open[0]?.id || '')
      if (!open.length) setMessage('No hay inventarios ABIERTO autorizados para tu usuario.')
    }).catch((error) => { if (active) setMessage(error instanceof Error ? error.message : 'No fue posible cargar el contexto de reconteos.') })
    return () => { active = false }
  }, [])

  const refresh = useCallback(async (announce = true) => {
    if (!inventoryId || !profile) return
    setBusy(true)
    try {
      const flushed = navigator.onLine ? await recountOfflineOutbox.flush(reconciliation) : null
      const queue = await reconciliation.recountQueue(inventoryId)
      const next = flushed ?? queue.active
      assignMission(next); setQueued(queue.queued_count); setRound(queue.round)
      if (announce) setMessage(next ? `Misión C${next.round} activa. ${recountOfflineOutbox.pendingForMission(next.id).length} evento(s) local(es) pendiente(s).` : queue.c1_completed ? `${queue.queued_count} misión(es) C${queue.round ?? 2} disponible(s).` : 'C1 todavía está EN CURSO. C2 se habilita al finalizar cobertura.')
    } catch (error) {
      const cached = recountOfflineOutbox.cachedMission()
      if (cached && cached.inventory_id === inventoryId) { assignMission(cached); setMessage('Sin conexión: continúas la misión descargada. Los avances se sincronizarán al reconectar.') }
      else setMessage(error instanceof Error ? error.message : 'No fue posible cargar la cola de reconteos.')
    } finally { setBusy(false) }
  }, [inventoryId, profile])

  useEffect(() => { if (inventoryId && profile) void refresh() }, [inventoryId, profile, refresh])

  async function claim() {
    if (blocked || !inventoryId) return
    setBusy(true)
    try {
      const next = await reconciliation.claimNextMission(inventoryId)
      assignMission(next); setQueued((value) => Math.max(0, value - (next ? 1 : 0)))
      setMessage(next ? `Misión C${next.round} iniciada. Conteo ciego activo.` : 'No hay misiones disponibles para tu rol.')
      if (next) { setFeedback({ tone: 'SUCCESS', message: 'Plan de ejecución descargado. No se muestran diferencias ni conteos previos.' }); interactionSounds.playRecountAssigned() }
    } catch (error) { fail(error) } finally { setBusy(false) }
  }

  async function onlineOrQueue(operation: Parameters<typeof recountOfflineOutbox.enqueue>[0], online: () => Promise<RecountMission | void>) {
    try {
      if (!navigator.onLine) { recountOfflineOutbox.enqueue(operation); setMessage('Guardado localmente sin conexión. Se enviará al recuperar red.'); setFeedback({ tone: 'OFFLINE', message: 'Avance C2 protegido localmente.' }); return }
      const next = await online(); if (next) assignMission(next)
      setMessage('Evidencia C2 registrada.'); setFeedback({ tone: 'SUCCESS', message: 'Progreso de subtarea guardado.' }); interactionSounds.playSaveSuccess()
    } catch (error) {
      if (error instanceof TypeError || /network|fetch/i.test(error instanceof Error ? error.message : '')) { recountOfflineOutbox.enqueue(operation); setMessage('Sin conexión: avance protegido localmente.'); return }
      fail(error)
    }
  }

  async function record() {
    if (!mission || !selectedSubtask || blocked) return
    const value = selectedSubtask.strategy === 'SERIAL_SWEEP' || selectedSubtask.strategy === 'TARGETED_SERIAL_SEARCH' ? 1 : Number(quantity)
    if (!Number.isInteger(value) || value < 1) { setMessage('Ingrese una cantidad mayor a cero.'); return }
    const operation = { kind: 'RECORD' as const, missionId: mission.id, subtaskId: selectedSubtask.id, location: selectedSubtask.location, quantity: value, serial: selectedSubtask.strategy.includes('SERIAL') ? serial.trim().toUpperCase() || null : null, batch: selectedSubtask.strategy === 'BATCH_LOCATION_RECOUNT' ? batch.trim().toUpperCase() || null : null, logisticUnit: null }
    setBusy(true); await onlineOrQueue(operation, () => reconciliation.recordSubtask(operation)); setSerial(''); setBatch(''); setQuantity(''); setBusy(false)
  }

  async function resolve(status: 'ZERO_CONFIRMED' | 'INACCESSIBLE' | 'ESCALATED') {
    if (!mission || !selectedSubtask || blocked) return
    if (status !== 'ZERO_CONFIRMED' && reason.trim().length < 3) { setMessage('Explique brevemente la condición de la ubicación.'); return }
    setBusy(true)
    await onlineOrQueue({ kind: 'RESOLVE', missionId: mission.id, subtaskId: selectedSubtask.id, status, reason: status === 'ZERO_CONFIRMED' ? null : reason.trim() }, () => reconciliation.resolveSubtask(selectedSubtask.id, status, status === 'ZERO_CONFIRMED' ? undefined : reason.trim()))
    setReason(''); setBusy(false)
  }

  async function finishSweep() { if (!mission || !selectedSubtask || blocked) return; setBusy(true); await onlineOrQueue({ kind: 'FINISH_SWEEP', missionId: mission.id, subtaskId: selectedSubtask.id }, () => reconciliation.finishSerialSweep(selectedSubtask.id)); setBusy(false) }
  async function addLocation() { if (!mission || !foundLocation.trim() || blocked) return; const location = foundLocation.trim().toUpperCase(); setBusy(true); await onlineOrQueue({ kind: 'ADD_LOCATION', missionId: mission.id, location, logisticUnit: null }, () => reconciliation.addLocation(mission.id, location)); setFoundLocation(''); setBusy(false) }
  async function reportFinding() { if (!mission || !selectedSubtask || blocked) return; setBusy(true); await onlineOrQueue({ kind: 'FINDING', missionId: mission.id, subtaskId: selectedSubtask.id, finding, note: findingNote.trim() || null }, async () => { await reconciliation.reportFinding(selectedSubtask.id, finding, findingNote.trim() || undefined) }); setFindingNote(''); setBusy(false) }
  async function finish() {
    if (!mission || blocked || !window.confirm(`¿Finalizar C${mission.round}? No se puede cerrar con ubicaciones pendientes o activas.`)) return
    setBusy(true)
    try {
      const result = await reconciliation.completeMission(mission.id); assignMission(null); await refresh(false)
      setMessage(result.review_required ? 'C2 cerrado con excepción: requiere revisión de Analista.' : result.next_round === 3 ? 'C2 cerrado: se creó C3 ciego.' : `C${result.round} finalizado y trazado.`)
      setFeedback({ tone: result.review_required || result.next_round === 3 ? 'WARNING' : 'SUCCESS', message: result.review_required ? 'Las ubicaciones inaccesibles fueron enviadas a revisión.' : 'Resultado de misión persistido.' })
    } catch (error) { fail(error) } finally { setBusy(false) }
  }
  function fail(error: unknown) { const next = error instanceof Error ? error.message : 'No fue posible completar la operación.'; setMessage(next); setFeedback({ tone: 'ERROR', message: next }); interactionSounds.playError() }

  const isSweep = selectedSubtask?.strategy === 'SERIAL_SWEEP'; const isSerial = selectedSubtask?.strategy === 'TARGETED_SERIAL_SEARCH' || isSweep
  const pending = mission ? recountOfflineOutbox.pendingForMission(mission.id).length : 0
  return <section className="recount-queue" aria-labelledby="recount-title">
    <header><p className="eyebrow">C2 2.0 · ejecución física ciega</p><h1 id="recount-title">RECONTEOS</h1><p>La conciliación usa una referencia lógica; la ejecución se resuelve por ubicación. No se muestran Softland, C1, diferencias ni el resultado esperado.</p></header>
    {captureGate?.blocked && <p className="form-error" role="alert">{captureGate.message ?? 'Captura bloqueada por Health Check.'}</p>}<OperationalFeedback tone={feedback.tone} message={feedback.message}/>
    {inventories.length > 0 && <label className="field"><span>Inventario abierto</span><select value={inventoryId} disabled={busy} onChange={(event) => setInventoryId(event.target.value)}>{inventories.map((item) => <option key={item.id} value={item.id}>{item.name}</option>)}</select></label>}
    {selectedInventory && profile && <p className="recount-queue__context">{selectedInventory.name} · {profile.display_name} · {profile.role}</p>}
    {!mission && inventoryId && <div className="recount-queue__empty"><div><strong>{queued} misiones disponibles</strong><small>{round ? ` · C${round}` : ''}</small></div><button className="button-primary" disabled={busy || blocked || !queued} onClick={() => void claim()}>{busy ? 'CARGANDO…' : 'INICIAR SIGUIENTE'}</button></div>}
    {mission && <article className="recount-mission"><h2>C{mission.round} · {mission.codigo}</h2><p>{mission.descripcion}</p>{mission.reference_type === 'PARTIDA' && <strong>LOTE / PARTIDA · {mission.reference_value}</strong>}<p className="form-warning">CONTEO CIEGO · {pending ? `${pending} avance(s) esperando sincronización.` : 'La información anterior permanece oculta.'}</p>
      <section className="recount-subtasks" aria-label="Plan de ejecución C2"><h3>Plan de ejecución</h3>{subtasks.map((subtask) => <SubtaskButton key={subtask.id} subtask={subtask} selected={selectedSubtask?.id === subtask.id} onSelect={() => setSelectedSubtaskId(subtask.id)}/>)}</section>
      {selectedSubtask && <section className="recount-subtask-workspace"><h3>{selectedSubtask.location} · {selectedSubtask.strategy.replaceAll('_', ' ')}</h3><p>{isSweep ? 'Escanea todas las series físicas de esta ubicación. No se mostrará una cantidad esperada.' : isSerial ? 'Valida la serie física etiquetada en esta ubicación.' : 'Valida SKU/lote y registra sólo la cantidad física encontrada.'}</p>
        {(selectedSubtask.status === 'PENDING' || selectedSubtask.status === 'ACTIVE') ? <><label className="field"><span>Ubicación verificada</span><input value={selectedSubtask.location} readOnly/></label>{isSerial && <label className="field"><span>Serie física</span><input value={serial} disabled={busy || blocked} maxLength={19} onChange={(event) => setSerial(event.target.value.toUpperCase())} autoFocus/></label>}{selectedSubtask.strategy === 'BATCH_LOCATION_RECOUNT' && <label className="field"><span>Partida / lote</span><input value={batch} disabled={busy || blocked} onChange={(event) => setBatch(event.target.value.toUpperCase())}/></label>}{!isSerial && <label className="field"><span>Cantidad encontrada</span><input value={quantity} disabled={busy || blocked} inputMode="numeric" onChange={(event) => setQuantity(event.target.value)}/></label>}<button className="button-primary" disabled={busy || blocked || (isSerial && !serial.trim()) || (!isSerial && !quantity.trim()) || (selectedSubtask.strategy === 'BATCH_LOCATION_RECOUNT' && !batch.trim())} onClick={() => void record()}>{isSweep ? 'REGISTRAR SERIE' : 'GUARDAR EVIDENCIA'}</button>{isSweep && <button className="button-secondary" disabled={busy || blocked || selectedSubtask.scanned_series_count === 0} onClick={() => void finishSweep()}>FINALIZAR BARRIDO</button>}<label className="field"><span>Motivo de excepción</span><input value={reason} disabled={busy || blocked} onChange={(event) => setReason(event.target.value)} placeholder="Pallet bloqueado, acceso restringido…"/></label><div className="recount-subtask-actions"><button className="button-secondary" disabled={busy || blocked} onClick={() => void resolve('ZERO_CONFIRMED')}>CONFIRMAR 0</button><button className="button-secondary" disabled={busy || blocked} onClick={() => void resolve('INACCESSIBLE')}>INACCESIBLE</button><button className="button-secondary" disabled={busy || blocked} onClick={() => void resolve('ESCALATED')}>ESCALAR</button></div></> : <p className="form-success">{selectedSubtask.status.replaceAll('_', ' ')}{selectedSubtask.counted_quantity !== null ? ` · ${selectedSubtask.counted_quantity} un.` : ''}</p>}
        <fieldset className="recount-finding"><legend>REPORTAR HALLAZGO</legend><select value={finding} disabled={busy || blocked} onChange={(event) => setFinding(event.target.value as RecountFindingType)}>{FINDINGS.map((item) => <option key={item} value={item}>{item.replaceAll('_', ' ')}</option>)}</select><input value={findingNote} disabled={busy || blocked} onChange={(event) => setFindingNote(event.target.value)} placeholder="Observación opcional"/><button className="button-secondary" disabled={busy || blocked} onClick={() => void reportFinding()}>REPORTAR</button></fieldset></section>}
      <section className="recount-add-location"><h3>Nueva ubicación encontrada</h3><input value={foundLocation} disabled={busy || blocked} onChange={(event) => setFoundLocation(event.target.value.toUpperCase())} placeholder="A-05-01 o TECHO"/><button className="button-secondary" disabled={busy || blocked || !foundLocation.trim()} onClick={() => void addLocation()}>AGREGAR UBICACIÓN</button></section><button className="button-primary" disabled={busy || blocked || subtasks.some((item) => item.status === 'PENDING' || item.status === 'ACTIVE')} onClick={() => void finish()}>FINALIZAR C{mission.round}</button></article>}
    <p className="recount-queue__message" role="status">{message}</p><button className="button-secondary" type="button" disabled={busy} onClick={() => void refresh()}>SINCRONIZAR / ACTUALIZAR</button>
  </section>
}

function SubtaskButton({ subtask, selected, onSelect }: { subtask: RecountSubtask; selected: boolean; onSelect: () => void }) { return <button type="button" className={`recount-subtask recount-subtask--${subtask.status.toLowerCase()} ${selected ? 'is-selected' : ''}`} onClick={onSelect}><strong>{subtask.location}</strong><span>{subtask.strategy.replaceAll('_', ' ')}</span><em>{subtask.status.replaceAll('_', ' ')}</em>{subtask.strategy === 'SERIAL_SWEEP' && <small>{subtask.scanned_series_count} SERIES ESCANEADAS</small>}</button> }
function locationOrder(left: RecountSubtask, right: RecountSubtask) { const ordered = sortExecutionLocations([left.location, right.location]); return ordered.indexOf(left.location) - ordered.indexOf(right.location) }
