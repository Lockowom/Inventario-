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
import { c1FindingOfflineOutbox } from '../findings/c1-finding-offline-outbox'
import { SupabaseFindingsRepository } from '../../services/supabase-findings-repository'
import { SupabaseC1LookupRepository, type C1TraceabilityOption } from '../../services/supabase-c1-lookup-repository'
import { isSupabaseConfigured } from '../../services/supabase'
import type { ActiveInventory } from '../control-center/active-inventory-context'
import type { C1Readiness } from './c1-readiness'

export interface CountingRuntime extends SavePhysicalCountDependencies { context: ActiveCountingContext }
export interface CountingInventoryContext {
  inventories: readonly ActiveInventory[]
  inventoryId: string
  activeInventory: ActiveInventory | null
  loading: boolean
  error: string | null
  selectInventory: (inventoryId: string) => void
}
const findingsRepository = new SupabaseFindingsRepository()
const c1LookupRepository = new SupabaseC1LookupRepository()
export type C1LookupRepository = Pick<SupabaseC1LookupRepository, 'lookupSku' | 'lookupTraceability'>

export function CountingScreen({ runtime, syncCoordinator, startupSyncMessage, readiness, readinessLoading = false, inventoryContext, lookupRepository }: { runtime: CountingRuntime | null; syncCoordinator?: SyncCoordinator | null; startupSyncMessage?: string; readiness?: C1Readiness | null; readinessLoading?: boolean; inventoryContext?: CountingInventoryContext; lookupRepository?: C1LookupRepository }) {
  const [draft, setDraft] = useState<PhysicalCountDraft>(emptyPhysicalCountDraft)
  const [master, setMaster] = useState<MasterSku | null>(null)
  const [skuLookupLoading, setSkuLookupLoading] = useState(false)
  const [traceabilityOptions, setTraceabilityOptions] = useState<C1TraceabilityOption[]>([])
  const [traceabilityMessage, setTraceabilityMessage] = useState('')
  const [message, setMessage] = useState('')
  const [saving, setSaving] = useState(false)
  const [refreshCounts, setRefreshCounts] = useState(0)
  const [pending, setPending] = useState<number | null>(null)
  const [syncing, setSyncing] = useState(false)
  const [syncState, setSyncState] = useState<CountSyncUiState>('IDLE')
  const [rejectedCount, setRejectedCount] = useState(0)
  const [feedback, setFeedback] = useState<{ tone: FeedbackTone; message: string }>({ tone: 'IDLE', message: '' })
  const [findingNote, setFindingNote] = useState('')
  const [findingCritical, setFindingCritical] = useState(false)
  const [findingOpen, setFindingOpen] = useState(false)
  const [findingPending, setFindingPending] = useState(0)
  const [findingReviewReasons, setFindingReviewReasons] = useState<string[]>([])
  const syncRuns = useRef(0)
  const codeInput = useRef<HTMLInputElement>(null)
  const serialInput = useRef<HTMLInputElement>(null)
  const batchInput = useRef<HTMLInputElement>(null)
  const quantityInput = useRef<HTMLInputElement>(null)
  useEffect(() => {
    if (!master) return
    if (master.controlType === 'SERIAL') serialInput.current?.focus()
    else if (master.controlType === 'PARTIDA') batchInput.current?.focus()
    else quantityInput.current?.focus()
  }, [master])
  const { preferences } = useExperiencePreferences()

  const runFindingSync = useCallback(async () => {
    if (!runtime || (typeof navigator !== 'undefined' && !navigator.onLine)) return
    c1FindingOfflineOutbox.setActor(runtime.context.userId)
    const result = await c1FindingOfflineOutbox.flush((item) => findingsRepository.reportC1Finding(item))
    setFindingPending(result.pending + result.reviewRequired)
    setFindingReviewReasons(c1FindingOfflineOutbox.reviewRequired().map((item) => item.reviewReason ?? 'REVIEW_REQUIRED'))
  }, [runtime])

  useEffect(() => {
    if (!runtime) return
    c1FindingOfflineOutbox.setActor(runtime.context.userId)
    setFindingPending(c1FindingOfflineOutbox.list().length)
    setFindingReviewReasons(c1FindingOfflineOutbox.reviewRequired().map((item) => item.reviewReason ?? 'REVIEW_REQUIRED'))
    if (typeof navigator !== 'undefined' && navigator.onLine) void runFindingSync()
    return () => { c1FindingOfflineOutbox.setActor(null) }
  }, [runtime, runFindingSync])

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
      if (summary.reviewRequired > 0) setSyncState('REVIEW_REQUIRED')
      else if (summary.rejected > 0) setSyncState('REJECTED')
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
    let active = true
    void runtime.counts.getOrCreateDeviceId(runtime.context.userId)
      .then((deviceId) => runtime.counts.countPendingByDevice(deviceId))
      .then((total) => { if (active) setPending(total) })
      .catch(() => { if (active) setMessage('No fue posible leer la capacidad local. El guardado permanece bloqueado.') })
    return () => { active = false }
  }, [runtime, refreshCounts])

  useEffect(() => {
    if (!runtime || !syncCoordinator) return
    const requestSync = () => { void runSync(); void runFindingSync() }
    const onResume = () => { if (document.visibilityState === 'visible') requestSync() }
    requestSync()
    window.addEventListener('online', requestSync)
    document.addEventListener('visibilitychange', onResume)
    return () => { window.removeEventListener('online', requestSync); document.removeEventListener('visibilitychange', onResume) }
  }, [runtime, runSync, runFindingSync, syncCoordinator])

  useEffect(() => {
    let active = true
    let unsubscribe: (() => Promise<void>) | undefined
    const applyRestoredResult = (result: { field: ScanField | null; value: string | null; error: string | null }, consumePersisted: boolean) => {
      if (!active || !runtime) return
      // The event processor persists a recovery result for a cold start; once
      // this live form consumes it, remove the duplicate copy.
      if (consumePersisted) consumeRestoredScannerResult()
      if (result.error) { setMessage(result.error); return }
      if (!result.field || !result.value) return
      if (result.field === 'codigo') void resolveSku(result.value)
      else if (result.field === 'ubicacion') applyLocation(result.value)
      else setDraft((current) => ({ ...current, [result.field!]: result.value! }))
    }
    if (runtime) {
      const recovered = consumeRestoredScannerResult()
      if (recovered) applyRestoredResult(recovered, false)
    }
    void subscribeToScannerRestoration((result) => applyRestoredResult(result, true)).then((remove) => { unsubscribe = remove })
    return () => { active = false; if (unsubscribe) void unsubscribe() }
  // The runtime controls the authorized inventory; scanner recovery must not outlive it.
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [runtime])

  const capacity = pending === null ? null : pendingCapacity(pending)
  // Local persistence protects offline captures, but its probe must never
  // prevent an authorized online operator from opening or looking up C1.
  const inputDisabled = saving || capacity === 'BLOCKED'
  const saveDisabled = inputDisabled || skuLookupLoading || !master
  const countSwipe = useSwipe({
    enabled: preferences.gestures,
    onSwipeLeft: () => setFeedback({ tone: 'WARNING', message: 'Revisa el conteo antes de confirmarlo.' }),
    onSwipeRight: () => {
      if (!runtime || saveDisabled) return
      if (window.confirm('¿Confirmar y guardar este conteo?')) void save()
    },
  })
  if (!runtime) return <section className="counting-screen" aria-labelledby="counting-title"><p className="eyebrow">C1 · Contexto operativo</p><h1 id="counting-title">CONTEO FÍSICO</h1><InventoryContextSelector context={inventoryContext} /><C1ReadinessMessage readiness={readiness} loading={readinessLoading} />{startupSyncMessage && <p className="sync-status" role="status">{startupSyncMessage}</p>}</section>
  const activeRuntime = runtime
  const invalidCode = draft.codigo.trim().length > 0 && master === null

  async function resolveSku(code = draft.codigo) {
    const online = (isSupabaseConfigured || lookupRepository !== undefined) && (typeof navigator === 'undefined' || navigator.onLine)
    setSkuLookupLoading(true)
    setTraceabilityOptions([])
    setTraceabilityMessage('')
    try {
      const resolution = online
        ? await resolveOnlineSku(activeRuntime.context.inventoryId, code, draft, lookupRepository ?? c1LookupRepository)
        : await resolveCountSku(activeRuntime.context.inventoryId, code, draft, activeRuntime.masters)
      setMaster(resolution.master)
      setDraft(resolution.draft)
      setMessage(resolution.error ?? '')
      if (resolution.error) { setFeedback({ tone: 'ERROR', message: resolution.error }); interactionSounds.playError() }
      else if (resolution.master) {
        setFeedback({ tone: 'SUCCESS', message: online ? 'SKU consultado en el inventario.' : 'SKU disponible desde la caché local.' })
        interactionSounds.playScanSuccess()
        const controlType = resolution.master.controlType
        if (online && (controlType === 'PARTIDA' || controlType === 'SERIAL')) void loadTraceability(activeRuntime.context.inventoryId, resolution.master.codigo, controlType)
      }
    } catch {
      const nextMessage = online ? 'No fue posible consultar el SKU. Reintenta.' : 'Este SKU no está disponible sin conexión.'
      setMaster(null)
      setMessage(nextMessage)
      setFeedback({ tone: 'ERROR', message: nextMessage })
      interactionSounds.playError()
    } finally { setSkuLookupLoading(false) }
  }

  async function loadTraceability(inventoryId: string, codigo: string, controlType: 'PARTIDA' | 'SERIAL') {
    try {
      const options = await (lookupRepository ?? c1LookupRepository).lookupTraceability(inventoryId, codigo, controlType)
      setTraceabilityOptions(options)
    } catch {
      setTraceabilityMessage(controlType === 'PARTIDA' ? 'No fue posible consultar las partidas.' : 'No fue posible consultar las series.')
    }
  }

  function updateCode(value: string) {
    setMaster(null)
    setTraceabilityOptions([])
    setTraceabilityMessage('')
    setDraft((current) => ({ ...current, codigo: value }))
  }
  function applyLocation(value: string) {
    const normalized = normalizeLocationInput(value)
    if (normalized === null) { setMessage(LOCATION_ERROR); return }
    setDraft((current) => ({ ...current, ubicacion: normalized }))
  }
  async function scan(field: ScanField) {
    const result = await scanBarcodeField(field)
    if (result.error) { setMessage(result.error); setFeedback({ tone: 'ERROR', message: result.error }); interactionSounds.playError(); return }
    if (!result.value) return
    if (field === 'codigo') await resolveSku(result.value)
    else if (field === 'ubicacion') applyLocation(result.value)
    else setDraft((current) => ({ ...current, [field]: result.value! }))
  }
  async function save() {
    if (capacity === 'BLOCKED') { setMessage('Se alcanzó el límite de 50 conteos pendientes en este dispositivo. Sincronice antes de continuar.'); return }
    setSaving(true); setMessage(''); setFeedback({ tone: 'WORKING', message: 'Validando y guardando localmente…' })
    try {
      const { savePhysicalCount } = await import('../../domain/count/save-physical-count')
      const saved = await savePhysicalCount(activeRuntime.context, draft, activeRuntime, master)
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
  async function reportFinding() {
    if (!master || !activeRuntime || invalidCode) {
      setMessage('Identifique primero el producto para registrar un hallazgo.')
      return
    }
    const description = findingNote.trim()
    if (!description) { setMessage('Describa la evidencia física del hallazgo.'); return }
    const referenceValue = master.controlType === 'SERIAL' ? draft.serie?.trim() || null : master.controlType === 'PARTIDA' ? draft.partida?.trim() || null : null
    if (master.controlType !== 'LEGACY' && !referenceValue) { setMessage(`Ingrese ${master.controlType === 'SERIAL' ? 'la serie' : 'la partida'} antes de reportar el hallazgo.`); return }
    c1FindingOfflineOutbox.setActor(activeRuntime.context.userId)
    c1FindingOfflineOutbox.enqueue({
      inventoryId: activeRuntime.context.inventoryId,
      referenceType: master.controlType,
      codigo: draft.codigo,
      referenceValue,
      findingType: 'OTHER',
      description,
      critical: findingCritical,
      capturedAt: new Date().toISOString(),
      evidence: {
        note: description,
        location: draft.ubicacion,
        quantity: draft.cantidadContada || null,
        serial: draft.serie || null,
        batch: draft.partida || null,
        physical_uom: master.controlType === 'SERIAL' ? 'UN' : null,
        capture_context: 'C1',
      },
    })
    setFindingNote(''); setFindingCritical(false); setFindingOpen(false)
    setFindingPending(c1FindingOfflineOutbox.list().length)
    setFindingReviewReasons(c1FindingOfflineOutbox.reviewRequired().map((item) => item.reviewReason ?? 'REVIEW_REQUIRED'))
    setMessage('HALLAZGO GUARDADO LOCALMENTE')
    setFeedback({ tone: 'SUCCESS', message: 'La evidencia permanece vinculada a su identidad y se sincronizará con autorización actual.' })
    await runFindingSync()
  }

  return <section className="counting-screen" aria-labelledby="counting-title">
    <p className="eyebrow">C1 · Contexto operativo</p><h1 id="counting-title">CONTEO FÍSICO</h1>
    <InventoryContextSelector context={inventoryContext} />
    <p className="form-success" role="status">Inventario activo: {inventoryContext?.activeInventory?.name ?? activeRuntime.context.inventoryId}. Estado: LISTO PARA CONTEO.</p>
    <CapacityStatus pending={pending} capacity={capacity} />
    <SyncStatus state={syncState} pending={pending} rejected={rejectedCount} syncing={syncing} onRetry={() => void runSync(true)} />
    <OperationalFeedback tone={feedback.tone} message={feedback.message} />
    {message && <p className={message === 'CONTEO GUARDADO' ? 'form-success' : 'form-error'} role="status">{message}</p>}
    <div className="counting-form" aria-disabled={inputDisabled} {...countSwipe}>
      <Field label="UBICACION"><TextInput value={draft.ubicacion} onChange={applyLocation} disabled={inputDisabled} maxLength={LOCATION_MAX_LENGTH} pattern="(?:TECHO|(?:C2|[ABCDEFGHI])-[0-9]{2}-[0-9]{2})" title="Formato permitido: TECHO, E-32-03 o C2-32-03" /><ScanButton field="ubicacion" onScan={scan} disabled={inputDisabled} /></Field>
      <Field label="CODIGO"><TextInput inputRef={codeInput} value={draft.codigo} onChange={updateCode} onBlur={() => void resolveSku()} disabled={inputDisabled || skuLookupLoading} className={master ? 'counting-code--valid' : invalidCode ? 'counting-code--invalid' : undefined} /><ScanButton field="codigo" onScan={scan} disabled={inputDisabled || skuLookupLoading} /></Field>
      <ProductIdentification master={master} hasCode={draft.codigo.trim().length > 0} invalid={invalidCode} loading={skuLookupLoading} />
      {master?.controlType === 'SERIAL' && <Field label="SERIE"><TextInput inputRef={serialInput} value={draft.serie ?? ''} onChange={(value) => setDraft((current) => ({ ...current, serie: value }))} disabled={inputDisabled} maxLength={19} list="c1-traceability-values" /><ScanButton field="serie" onScan={scan} disabled={inputDisabled} /></Field>}
      {master?.controlType === 'PARTIDA' && <Field label="PARTIDA"><TextInput inputRef={batchInput} value={draft.partida ?? ''} onChange={(value) => setDraft((current) => ({ ...current, partida: value }))} disabled={inputDisabled} list="c1-traceability-values" /><ScanButton field="partida" onScan={scan} disabled={inputDisabled} /></Field>}
      {traceabilityOptions.length > 0 && <datalist id="c1-traceability-values">{traceabilityOptions.map((option) => <option key={`${option.value}-${option.expirationDate ?? ''}`} value={option.value}>{option.expirationDate ? `Vence ${option.expirationDate}` : ''}</option>)}</datalist>}
      {traceabilityMessage && <p className="form-warning" role="status">{traceabilityMessage}</p>}
      {master && <Field label="FECHA DE VENCIMIENTO"><input type="date" value={draft.fechaVencimiento ?? ''} onChange={(event) => setDraft((current) => ({ ...current, fechaVencimiento: event.target.value }))} disabled={inputDisabled} /></Field>}
      {master?.controlType === 'SERIAL'
        ? <Field label="CANTIDAD CONTADA"><input value="1" readOnly aria-readonly="true" inputMode="numeric" /></Field>
        : master && <Field label="CANTIDAD CONTADA"><TextInput inputRef={quantityInput} value={draft.cantidadContada} onChange={(value) => setDraft((current) => ({ ...current, cantidadContada: value }))} disabled={inputDisabled} inputMode="numeric" /></Field>}
    </div>
    <button className="button-primary counting-save" type="button" disabled={saveDisabled} onClick={() => void save()}>{saving ? 'GUARDANDO…' : 'GUARDAR CONTEO'}</button>
    <section className="counting-finding" aria-labelledby="counting-finding-title">
      <h2 id="counting-finding-title">HALLAZGO FÍSICO</h2>
      <p>Registre evidencia observada; no modifica stock ni resuelve el hallazgo automáticamente.</p>
      {findingPending > 0 && <p className="form-warning" role="status">{findingPending} hallazgo(s) local(es) pendiente(s) o en revisión.</p>}
      {findingReviewReasons.map((reason, index) => <p className="form-warning" key={`${reason}-${index}`} role="status">REVISIÓN REQUERIDA: {findingReviewLabel(reason)}</p>)}
      {!findingOpen
        ? <button className="button-secondary" type="button" disabled={saveDisabled} onClick={() => setFindingOpen(true)}>REPORTAR HALLAZGO</button>
        : <div className="counting-finding__form"><Field label="EVIDENCIA"><textarea value={findingNote} onChange={(event) => setFindingNote(event.target.value)} maxLength={4000} disabled={inputDisabled} /></Field><label><input type="checkbox" checked={findingCritical} onChange={(event) => setFindingCritical(event.target.checked)} disabled={inputDisabled} /> Hallazgo crítico</label><div><button className="button-primary" type="button" disabled={saveDisabled} onClick={() => void reportFinding()}>GUARDAR HALLAZGO</button><button className="button-secondary" type="button" onClick={() => setFindingOpen(false)}>CANCELAR</button></div></div>}
    </section>
    <MyCounts runtime={activeRuntime} refreshKey={refreshCounts} />
  </section>
}

function InventoryContextSelector({ context }: { context?: CountingInventoryContext }) {
  if (!context) return null
  if (context.loading) return <p className="form-warning" role="status">Cargando inventarios autorizados…</p>
  if (context.error) return <p className="form-error" role="alert">{context.error}</p>
  if (context.inventories.length === 0) return <p className="form-error" role="alert">No tienes inventarios autorizados para operar.</p>
  if (context.inventories.length === 1 && context.activeInventory) return <p className="form-success" role="status">Inventario activo: {context.activeInventory.name}.</p>
  return <section className="counting-inventory-selector" aria-labelledby="counting-inventory-selector-title">
    <h2 id="counting-inventory-selector-title">INVENTARIO ACTIVO</h2>
    <p>Tienes múltiples inventarios abiertos autorizados. Selecciona el inventario con el que deseas trabajar.</p>
    <label className="field"><span>Inventario para C1</span><select value={context.inventoryId} onChange={(event) => context.selectInventory(event.target.value)}><option value="">Seleccione un inventario</option>{context.inventories.map((inventory) => <option key={inventory.id} value={inventory.id}>{inventory.name} · {inventory.status}</option>)}</select></label>
  </section>
}

function C1ReadinessMessage({ readiness, loading }: { readiness?: C1Readiness | null; loading: boolean }) {
  if (loading) return <p className="form-warning" role="status">Validando acceso al inventario…</p>
  if (!readiness) return <p className="form-warning" role="status">Selecciona un inventario para comenzar el conteo.</p>
  if (readiness.kind === 'C1_READY') return <p className="form-success" role="status">{readiness.message}</p>
  const critical = readiness.kind === 'USER_NOT_READY'
  return <p className={critical ? 'form-error' : 'form-warning'} role={critical ? 'alert' : 'status'}>{readiness.message}</p>
}

function Field({ label, children }: { label: string; children: ReactNode }) { return <label className="field"><span>{label}</span><span className="field__controls">{children}</span></label> }
function TextInput({ value, onChange, onBlur, disabled, maxLength, inputMode, inputRef, pattern, title, className, list }: { value: string; onChange: (value: string) => void; onBlur?: () => void; disabled: boolean; maxLength?: number; inputMode?: 'numeric'; inputRef?: RefObject<HTMLInputElement | null>; pattern?: string; title?: string; className?: string; list?: string }) { return <input ref={inputRef} value={value} onChange={(event) => onChange(event.target.value)} onBlur={onBlur} disabled={disabled} maxLength={maxLength} inputMode={inputMode} pattern={pattern} title={title} className={className} list={list} /> }
function ScanButton({ field, onScan, disabled }: { field: ScanField; onScan: (field: ScanField) => Promise<void>; disabled: boolean }) { return <button type="button" className="button-secondary" disabled={disabled} aria-label={`Escanear ${field}`} onClick={() => void onScan(field)}>ESCANEAR</button> }
function findingReviewLabel(reason: string) { return reason === 'REFERENCE_SEALED' ? 'la referencia se selló antes de sincronizar' : reason === 'AUTHORIZATION_REVOKED' ? 'la autorización fue revocada antes de sincronizar' : reason === 'STALE_ASSIGNMENT' ? 'la asignación cambió antes de sincronizar' : 'la evidencia requiere revisión operativa' }

function ProductIdentification({ master, hasCode, invalid, loading }: { master: MasterSku | null; hasCode: boolean; invalid: boolean; loading: boolean }) {
  if (invalid) return <p className="counting-product-card counting-product-card--error" role="alert">⚠ SKU no registrado en este inventario.</p>
  if (!master) return hasCode ? <p className="counting-product-card" aria-live="polite">{loading ? 'Buscando producto…' : 'Ingresa o escanea un código para consultar el inventario.'}</p> : null
  return <section className="counting-product-card" aria-live="polite" aria-label="Producto identificado"><strong>✓ PRODUCTO IDENTIFICADO</strong><span>{master.descripcion}</span><em>{master.controlType}</em></section>
}

async function resolveOnlineSku(inventoryId: string, rawCode: string, draft: PhysicalCountDraft, lookupRepository: C1LookupRepository) {
  const codigo = rawCode.trim().toUpperCase()
  const clearedDraft: PhysicalCountDraft = { ...draft, codigo, serie: '', partida: '', piezaProducto: '', fechaVencimiento: '', talla: '', color: '', physicalUom: '', cantidadContada: '' }
  if (!codigo) return { master: null, draft: clearedDraft, error: null }
  const master = await lookupRepository.lookupSku(inventoryId, codigo)
  if (!master) return { master: null, draft: clearedDraft, error: 'SKU no registrado en este inventario.' }
  return { master, draft: { ...clearedDraft, cantidadContada: master.controlType === 'SERIAL' ? '1' : '' }, error: null }
}

function SyncStatus({ state, pending, rejected, syncing, onRetry }: { state: CountSyncUiState; pending: number | null; rejected: number; syncing: boolean; onRetry: () => void }) {
  // C1 must open directly against the selected inventory. The durable outbox
  // remains active, but its healthy/empty state is not an operational step.
  if (pending === null || (pending === 0 && (state === 'IDLE' || state === 'CONFIRMED'))) return null
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
  return <section id="mis-conteos" className="my-counts" aria-labelledby="my-counts-title"><h2 id="my-counts-title">MIS CONTEOS</h2><label className="field"><span>Buscar por código, serie, partida o ubicación</span><input value={search} onChange={(event) => setSearch(event.target.value)} /></label><ul>{counts.map((count) => <li key={count.clientCountId}><time>{new Date(count.capturedAt).toLocaleTimeString()}</time><strong>{count.ubicacion}</strong><span>{count.codigo} · {count.descripcion}</span><span>{count.serie ?? count.partida ?? 'Sin serie/partida'} · {count.cantidadContada}</span><em>{syncLabel(count)}</em>{syncDetail(count) && <small>{syncDetail(count)}</small>}</li>)}</ul>{counts.length === 0 && <p>No hay conteos locales para este inventario.</p>}</section>
}

function syncLabel(count: LocalCountRecord): string {
  if (count.syncStatus === 'CONFIRMED') return 'Confirmado en servidor'
  if (count.syncStatus === 'REVIEW_REQUIRED') return 'Evidencia preservada para revisión'
  if (count.syncStatus === 'REJECTED') return `Rechazado: ${count.lastSyncError ?? 'requiere revisión'}`
  if (count.syncStatus === 'FAILED') return 'Pendiente de reintento'
  if (count.syncStatus === 'SYNCING') return 'Sincronizando…'
  return 'Pendiente de sincronización'
}

function syncDetail(count: LocalCountRecord): string | null {
  if (count.syncStatus === 'REVIEW_REQUIRED' && count.lastSyncError === 'REFERENCE_SEALED') return 'La evidencia se registró después del cierre y quedó disponible para revisión.'
  return count.lastSyncError
}

function CapacityStatus({ pending, capacity }: { pending: number | null; capacity: PendingCapacity | null }) {
  // Normal local capacity is deliberately quiet. It only becomes visible
  // when the outbox itself needs operator action.
  if (pending === null || capacity === 'NORMAL') return null
  const status = getCapacityStatus(pending)
  const content = <><span>Capacidad local</span>{status.message}</>
  if (capacity === 'BLOCKED' || capacity === 'CRITICAL') return <p className="form-error capacity-status" role="alert">{content}</p>
  if (capacity === 'WARNING') return <p className="form-warning capacity-status" role="status">{content}</p>
  return <p className="capacity-status" role="status">{content}</p>
}
