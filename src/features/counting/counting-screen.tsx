import { useCallback, useEffect, useRef, useState, type ReactNode, type RefObject } from 'react'
import { LOCATION_ERROR, LOCATION_MAX_LENGTH, normalizeLocationInput, PhysicalCountValidationError, pendingCapacity, type LocalCountRecord, type PendingCapacity, type PhysicalCountDraft } from '../../domain/count/contracts'
import type { ActiveCountingContext, SavePhysicalCountDependencies } from '../../domain/count/save-physical-count'
import type { MasterSku } from '../../domain/master/contracts'
import { resolveCountSku } from '../../domain/count/resolve-count-sku'
import { scanBarcodeField, type ScanField } from '../../scanner/barcode-scanner'
import { consumeRestoredScannerResult } from '../../scanner/scanner-restoration'
import { subscribeToScannerRestoration } from '../../scanner/scanner-restoration-subscription'
import { emptyPhysicalCountDraft, resetAfterSuccessfulSave } from './form-state'
import { getCapacityStatus } from './capacity-status'
import { getCountSyncUiModel, type CountSyncUiState } from './sync-ui-state'
import type { SyncCoordinator } from '../../domain/sync/sync-coordinator'
import { OperationalFeedback, type FeedbackTone } from '../../ui/feedback/operational-feedback'
import { interactionSounds } from '../../ui/sound/interaction-sound-service'
import { useExperiencePreferences } from '../../ui/preferences/experience-preferences'
import { useSwipe } from '../../ui/gestures/use-gestures'

export interface CountingRuntime extends SavePhysicalCountDependencies { context: ActiveCountingContext }
export interface CaptureGate { blocked: boolean; message: string | null }

export function CountingScreen({ runtime, syncCoordinator, startupSyncMessage, captureGate }: { runtime: CountingRuntime | null; syncCoordinator?: SyncCoordinator | null; startupSyncMessage?: string; captureGate?: CaptureGate }) {
  const [draft, setDraft] = useState<PhysicalCountDraft>(emptyPhysicalCountDraft)
  const [master, setMaster] = useState<MasterSku | null>(null)
  const [masterAvailable, setMasterAvailable] = useState<boolean | null>(null)
  const [message, setMessage] = useState('')
  const [saving, setSaving] = useState(false)
  const [refreshCounts, setRefreshCounts] = useState(0)
  const [pending, setPending] = useState<number | null>(null)
  const [syncing, setSyncing] = useState(false)
  const [syncState, setSyncState] = useState<CountSyncUiState>('IDLE')
  const [rejectedCount, setRejectedCount] = useState(0)
  const [feedback, setFeedback] = useState<{ tone: FeedbackTone; message: string }>({ tone: 'IDLE', message: '' })
  const syncRuns = useRef(0)
  const codeInput = useRef<HTMLInputElement>(null)
  const serialInput = useRef<HTMLInputElement>(null)
  const batchInput = useRef<HTMLInputElement>(null)
  const quantityInput = useRef<HTMLInputElement>(null)
  const healthBlocked = captureGate?.blocked === true
  const { preferences } = useExperiencePreferences()

  const runSync = useCallback(async (forceRetry = false) => {
    if (!syncCoordinator || !runtime) return
    let deviceId: string
    let pendingBefore: number
    try {
      deviceId = await runtime.counts.getOrCreateDeviceId(runtime.context.userId)
      pendingBefore = await runtime.counts.countPendingByDevice(deviceId)
    } catch {
      setSyncState('ERROR')
      return
    }
    setPending(pendingBefore)
    if (pendingBefore === 0) {
      setSyncing(false)
      setSyncState('IDLE')
      return
    }
    if (typeof navigator !== 'undefined' && !navigator.onLine) {
      setSyncState('OFFLINE')
      return
    }
    syncRuns.current += 1
    setSyncing(true)
    setSyncState('SYNCING')
    try {
      const summary = await syncCoordinator.runInventorySync(runtime.context.inventoryId, { forceRetry })
      const pendingAfter = await runtime.counts.countPendingByDevice(deviceId)
      setPending(pendingAfter)
      setRejectedCount(summary.rejected)
      if (summary.rejected > 0) setSyncState('REJECTED')
      else if (summary.failed > 0) setSyncState('RETRY_PENDING')
      else if (pendingAfter === 0) setSyncState(summary.confirmed > 0 ? 'CONFIRMED' : 'IDLE')
      else setSyncState('RETRY_PENDING')
      if (summary.confirmed > 0 && summary.failed === 0) interactionSounds.playSyncComplete()
      setRefreshCounts((value) => value + 1)
    } catch {
      setSyncState('ERROR')
    } finally {
      syncRuns.current -= 1
      if (syncRuns.current === 0) setSyncing(false)
    }
  }, [runtime, syncCoordinator])
  useEffect(() => {
    if (!runtime) return
    void runtime.masters.getMetadata(runtime.context.inventoryId).then((metadata) => setMasterAvailable(Boolean(metadata))).catch(() => setMasterAvailable(false))
  }, [runtime])

  useEffect(() => {
    if (!runtime) return
    let active = true
    void runtime.counts.getOrCreateDeviceId(runtime.context.userId)
      .then((deviceId) => runtime.counts.countPendingByDevice(deviceId))
      .then((total) => { if (active) setPending(total) })
      .catch(() => { if (active) setMessage('No fue posible leer la capacidad local. El guardado permanece bloqueado.') })
    return () => { active = false }
  }, [runtime, refreshCounts])

  useEffect(() => {
    if (!runtime || !syncCoordinator) return
    const requestSync = () => { void runSync() }
    const onResume = () => { if (document.visibilityState === 'visible') requestSync() }
    requestSync()
    window.addEventListener('online', requestSync)
    document.addEventListener('visibilitychange', onResume)
    return () => { window.removeEventListener('online', requestSync); document.removeEventListener('visibilitychange', onResume) }
  }, [runtime, runSync, syncCoordinator])

  useEffect(() => {
    let active = true
    let unsubscribe: (() => Promise<void>) | undefined
    const applyRestoredResult = (result: { field: ScanField | null; value: string | null; error: string | null }, consumePersisted: boolean) => {
      // Keep recovery durable while Health denies new capture. A future READY
      // lifecycle will consume this exact persisted result once.
      if (!active || !runtime || healthBlocked) return
      // The event processor persists a recovery result for a cold start; once
      // this live form consumes it, remove the duplicate copy.
      if (consumePersisted) consumeRestoredScannerResult()
      if (result.error) { setMessage(result.error); return }
      if (!result.field || !result.value) return
      if (result.field === 'codigo') void resolveSku(result.value)
      else if (result.field === 'ubicacion') applyLocation(result.value)
      else setDraft((current) => ({ ...current, [result.field!]: result.value! }))
    }
    if (runtime && !healthBlocked) {
      const recovered = consumeRestoredScannerResult()
      if (recovered) applyRestoredResult(recovered, false)
    }
    void subscribeToScannerRestoration((result) => applyRestoredResult(result, true)).then((remove) => { unsubscribe = remove })
    return () => { active = false; if (unsubscribe) void unsubscribe() }
  // The runtime controls the authorized inventory; scanner recovery must not outlive it.
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [runtime, healthBlocked])

  async function runOutstandingSync() {
    if (runtime) { await runSync(true); return }
    if (!syncCoordinator || syncing) return
    setSyncing(true)
    try {
      const summary = await syncCoordinator.runOutstanding({ forceRetry: true })
      setSyncState(summary.rejected > 0 ? 'REJECTED' : summary.failed > 0 ? 'RETRY_PENDING' : 'IDLE')
    } catch { setSyncState('ERROR') } finally { setSyncing(false) }
  }

  const capacity = pending === null ? null : pendingCapacity(pending)
  const countSwipe = useSwipe({
    enabled: preferences.gestures && !healthBlocked,
    onSwipeLeft: () => setFeedback({ tone: 'WARNING', message: 'Revisa el conteo antes de confirmarlo.' }),
    onSwipeRight: () => {
      if (!runtime || masterAvailable !== true || saving || pending === null || capacity === 'BLOCKED') return
      if (window.confirm('¿Confirmar y guardar este conteo?')) void save()
    },
  })
  if (!runtime) return <section className="counting-screen" aria-labelledby="counting-title"><p className="eyebrow">Fase 4 · Captura bloqueada</p><h1 id="counting-title">CONTEO FÍSICO</h1><p className="form-error" role="alert">{captureGate?.message ?? 'Captura no disponible: seleccione un inventario ABIERTO desde el contexto autenticado.'}</p><section className="sync-status" aria-label="Estado de sincronización pendiente"><p role="status">{startupSyncMessage || 'Los conteos locales pendientes permanecen protegidos y disponibles para sincronización.'}</p><button className="button-secondary" type="button" disabled={!syncCoordinator || syncing} onClick={() => void runOutstandingSync()}>{syncing ? 'SINCRONIZANDO…' : 'REINTENTAR SINCRONIZACIÓN'}</button></section></section>
  const activeRuntime = runtime
  const invalidCode = draft.codigo.trim().length > 0 && master === null
  const disabled = healthBlocked || masterAvailable !== true || saving || pending === null || capacity === 'BLOCKED' || invalidCode

  async function resolveSku(code = draft.codigo) {
    const resolution = await resolveCountSku(activeRuntime.context.inventoryId, code, draft, activeRuntime.masters)
    setMaster(resolution.master)
    setDraft(resolution.draft)
    setMessage(resolution.error ?? '')
    if (resolution.error) { setFeedback({ tone: 'ERROR', message: resolution.error }); interactionSounds.playError() }
    else if (resolution.master) {
      setFeedback({ tone: 'SUCCESS', message: 'SKU validado contra el Maestro local.' }); interactionSounds.playScanSuccess()
      requestAnimationFrame(() => {
        if (resolution.master?.controlType === 'SERIAL') serialInput.current?.focus()
        else if (resolution.master?.controlType === 'PARTIDA') batchInput.current?.focus()
        else quantityInput.current?.focus()
      })
    }
  }
  function updateCode(value: string) {
    setMaster(null)
    setDraft((current) => ({ ...current, codigo: value }))
  }
  function applyLocation(value: string) {
    const normalized = normalizeLocationInput(value)
    if (normalized === null) { setMessage(LOCATION_ERROR); return }
    setDraft((current) => ({ ...current, ubicacion: normalized }))
  }
  async function scan(field: ScanField) {
    if (healthBlocked) return
    const result = await scanBarcodeField(field)
    if (result.error) { setMessage(result.error); setFeedback({ tone: 'ERROR', message: result.error }); interactionSounds.playError(); return }
    if (!result.value) return
    if (field === 'codigo') await resolveSku(result.value)
    else if (field === 'ubicacion') applyLocation(result.value)
    else setDraft((current) => ({ ...current, [field]: result.value! }))
  }
  async function save() {
    if (healthBlocked) { setMessage(captureGate?.message ?? 'Captura bloqueada por Health Check. Revise los controles marcados como FAIL.'); return }
    if (capacity === 'BLOCKED') { setMessage('Se alcanzó el límite de 50 conteos pendientes en este dispositivo. Sincronice antes de continuar.'); return }
    setSaving(true); setMessage(''); setFeedback({ tone: 'WORKING', message: 'Validando y guardando localmente…' })
    try {
      const { savePhysicalCount } = await import('../../domain/count/save-physical-count')
      const saved = await savePhysicalCount(activeRuntime.context, draft, activeRuntime)
      setMessage('CONTEO GUARDADO')
      setSyncState(navigator.onLine ? 'LOCAL_SAVED' : 'OFFLINE')
      setFeedback({ tone: 'SUCCESS', message: 'Conteo guardado localmente.' })
      interactionSounds.playSaveSuccess()
      setPending(saved.pending)
      setDraft((current) => resetAfterSuccessfulSave(current))
      setMaster(null)
      setRefreshCounts((value) => value + 1)
      void runSync()
      requestAnimationFrame(() => codeInput.current?.focus())
    } catch (error: unknown) {
      const nextMessage = error instanceof PhysicalCountValidationError || error instanceof Error ? error.message : 'No fue posible guardar localmente. Sus datos siguen en el formulario.'
      setMessage(nextMessage); setFeedback({ tone: 'ERROR', message: nextMessage }); interactionSounds.playError()
    } finally { setSaving(false) }
  }

  return <section className="counting-screen" aria-labelledby="counting-title">
    <p className="eyebrow">Offline-first · Inventario ABIERTO</p><h1 id="counting-title">CONTEO FÍSICO</h1>
    {healthBlocked && <p className="form-error" role="alert">{captureGate?.message ?? 'Captura bloqueada por Health Check. Revise los controles marcados como FAIL.'}</p>}
    {masterAvailable === false && <p className="form-error" role="alert">No existe un maestro SKU disponible en este dispositivo. Actualice el maestro antes de iniciar el conteo.</p>}
    <CapacityStatus pending={pending} capacity={capacity} />
    <SyncStatus state={syncState} pending={pending} rejected={rejectedCount} syncing={syncing} onRetry={() => void runSync(true)} />
    <OperationalFeedback tone={feedback.tone} message={feedback.message} />
    {message && <p className={message === 'CONTEO GUARDADO' ? 'form-success' : 'form-error'} role="status">{message}</p>}
    <div className="counting-form" aria-disabled={disabled} {...countSwipe}>
      <Field label="UBICACION"><TextInput value={draft.ubicacion} onChange={applyLocation} disabled={disabled} maxLength={LOCATION_MAX_LENGTH} pattern="(?:TECHO|(?:C2|[ABCDFGHI])-[0-9]{2}-[0-9]{2})" title="Formato permitido: TECHO, F-32-03 o C2-32-03" /><ScanButton field="ubicacion" onScan={scan} disabled={disabled} /></Field>
      <Field label="CODIGO"><TextInput inputRef={codeInput} value={draft.codigo} onChange={updateCode} onBlur={() => void resolveSku()} disabled={healthBlocked || masterAvailable !== true || saving || pending === null || capacity === 'BLOCKED'} className={master ? 'counting-code--valid' : invalidCode ? 'counting-code--invalid' : undefined} /><ScanButton field="codigo" onScan={scan} disabled={healthBlocked || masterAvailable !== true || saving || pending === null || capacity === 'BLOCKED'} /></Field>
      <ProductIdentification master={master} hasCode={draft.codigo.trim().length > 0} invalid={invalidCode} />
      {master?.controlType === 'SERIAL' && <Field label="SERIE"><TextInput inputRef={serialInput} value={draft.serie ?? ''} onChange={(value) => setDraft((current) => ({ ...current, serie: value }))} disabled={disabled} maxLength={19} /><ScanButton field="serie" onScan={scan} disabled={disabled} /></Field>}
      {master?.controlType === 'PARTIDA' && <Field label="PARTIDA"><TextInput inputRef={batchInput} value={draft.partida ?? ''} onChange={(value) => setDraft((current) => ({ ...current, partida: value }))} disabled={disabled} /><ScanButton field="partida" onScan={scan} disabled={disabled} /></Field>}
      {master && <Field label="FECHA DE VENCIMIENTO"><input type="date" value={draft.fechaVencimiento ?? ''} onChange={(event) => setDraft((current) => ({ ...current, fechaVencimiento: event.target.value }))} disabled={disabled} /></Field>}
      {master?.controlType === 'SERIAL'
        ? <Field label="CANTIDAD CONTADA"><input value="1" readOnly aria-readonly="true" inputMode="numeric" /></Field>
        : master && <Field label="CANTIDAD CONTADA"><TextInput inputRef={quantityInput} value={draft.cantidadContada} onChange={(value) => setDraft((current) => ({ ...current, cantidadContada: value }))} disabled={disabled} inputMode="numeric" /></Field>}
    </div>
    <button className="button-primary counting-save" type="button" disabled={disabled} onClick={() => void save()}>{saving ? 'GUARDANDO…' : 'GUARDAR CONTEO'}</button>
    <MyCounts runtime={activeRuntime} refreshKey={refreshCounts} />
  </section>
}

function Field({ label, children }: { label: string; children: ReactNode }) { return <label className="field"><span>{label}</span><span className="field__controls">{children}</span></label> }
function TextInput({ value, onChange, onBlur, disabled, maxLength, inputMode, inputRef, pattern, title, className }: { value: string; onChange: (value: string) => void; onBlur?: () => void; disabled: boolean; maxLength?: number; inputMode?: 'numeric'; inputRef?: RefObject<HTMLInputElement | null>; pattern?: string; title?: string; className?: string }) { return <input ref={inputRef} value={value} onChange={(event) => onChange(event.target.value)} onBlur={onBlur} disabled={disabled} maxLength={maxLength} inputMode={inputMode} pattern={pattern} title={title} className={className} /> }
function ScanButton({ field, onScan, disabled }: { field: ScanField; onScan: (field: ScanField) => Promise<void>; disabled: boolean }) { return <button type="button" className="button-secondary" disabled={disabled} aria-label={`Escanear ${field}`} onClick={() => void onScan(field)}>ESCANEAR</button> }

function ProductIdentification({ master, hasCode, invalid }: { master: MasterSku | null; hasCode: boolean; invalid: boolean }) {
  if (invalid) return <p className="counting-product-card counting-product-card--error" role="alert">⚠ CÓDIGO NO ENCONTRADO EN MAESTRO</p>
  if (!master) return hasCode ? <p className="counting-product-card" aria-live="polite">Validando código contra el Maestro local…</p> : null
  return <section className="counting-product-card" aria-live="polite" aria-label="Producto identificado"><strong>✓ PRODUCTO IDENTIFICADO</strong><span>{master.descripcion}</span><em>{master.controlType}</em></section>
}

function SyncStatus({ state, pending, rejected, syncing, onRetry }: { state: CountSyncUiState; pending: number | null; rejected: number; syncing: boolean; onRetry: () => void }) {
  if (pending === null) return <section className="sync-status" aria-label="Estado de sincronización"><p role="status">Comprobando sincronización local…</p></section>
  const model = getCountSyncUiModel(state, pending, rejected)
  return <section className={`sync-status sync-status--${state.toLowerCase()}`} aria-label="Estado de sincronización">
    <div><strong>{model.title}</strong><p role="status">{model.detail}</p></div>
    {model.action === 'RETRY' && !syncing && <button className="button-secondary" type="button" onClick={onRetry}>REINTENTAR SINCRONIZACIÓN</button>}
    {model.action === 'DETAIL' && <a href="#mis-conteos">VER DETALLE</a>}
  </section>
}

function MyCounts({ runtime, refreshKey }: { runtime: CountingRuntime; refreshKey: number }) {
  const [search, setSearch] = useState('')
  const [counts, setCounts] = useState<LocalCountRecord[]>([])
  useEffect(() => { void runtime.counts.listOwnCounts({ inventoryId: runtime.context.inventoryId, userId: runtime.context.userId, search }).then(setCounts) }, [runtime, search, refreshKey])
  return <section id="mis-conteos" className="my-counts" aria-labelledby="my-counts-title"><h2 id="my-counts-title">MIS CONTEOS</h2><label className="field"><span>Buscar por código, serie, partida o ubicación</span><input value={search} onChange={(event) => setSearch(event.target.value)} /></label><ul>{counts.map((count) => <li key={count.clientCountId}><time>{new Date(count.capturedAt).toLocaleTimeString()}</time><strong>{count.ubicacion}</strong><span>{count.codigo} · {count.descripcion}</span><span>{count.serie ?? count.partida ?? 'Sin serie/partida'} · {count.cantidadContada}</span><em>{syncLabel(count)}</em>{count.lastSyncError && <small>{count.lastSyncError}</small>}</li>)}</ul>{counts.length === 0 && <p>No hay conteos locales para este inventario.</p>}</section>
}

function syncLabel(count: LocalCountRecord): string {
  if (count.syncStatus === 'CONFIRMED') return 'Confirmado en servidor'
  if (count.syncStatus === 'REJECTED') return `Rechazado: ${count.lastSyncError ?? 'requiere revisión'}`
  if (count.syncStatus === 'FAILED') return 'Pendiente de reintento'
  if (count.syncStatus === 'SYNCING') return 'Sincronizando…'
  return 'Pendiente de sincronización'
}

function CapacityStatus({ pending, capacity }: { pending: number | null; capacity: PendingCapacity | null }) {
  if (pending === null) return <p role="status">Comprobando capacidad local…</p>
  const status = getCapacityStatus(pending)
  const content = <><span>Capacidad local</span>{status.message}</>
  if (capacity === 'BLOCKED' || capacity === 'CRITICAL') return <p className="form-error capacity-status" role="alert">{content}</p>
  if (capacity === 'WARNING') return <p className="form-warning capacity-status" role="status">{content}</p>
  return <p className="capacity-status" role="status">{content}</p>
}
