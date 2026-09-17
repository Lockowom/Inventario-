import { useEffect, useRef, useState, type ReactNode, type RefObject } from 'react'
import { PhysicalCountValidationError, pendingCapacity, type LocalCountRecord, type PendingCapacity, type PhysicalCountDraft } from '../../domain/count/contracts'
import type { ActiveCountingContext, SavePhysicalCountDependencies } from '../../domain/count/save-physical-count'
import type { MasterSku } from '../../domain/master/contracts'
import { resolveCountSku } from '../../domain/count/resolve-count-sku'
import { scanBarcodeField, type ScanField } from '../../scanner/barcode-scanner'
import { consumeRestoredScannerResult, subscribeToScannerRestoration } from '../../scanner/scanner-restoration'
import { emptyPhysicalCountDraft, resetAfterSuccessfulSave } from './form-state'
import { getCapacityStatus } from './capacity-status'

export interface CountingRuntime extends SavePhysicalCountDependencies { context: ActiveCountingContext }

export function CountingScreen({ runtime }: { runtime: CountingRuntime | null }) {
  const [draft, setDraft] = useState<PhysicalCountDraft>(emptyPhysicalCountDraft)
  const [master, setMaster] = useState<MasterSku | null>(null)
  const [masterAvailable, setMasterAvailable] = useState<boolean | null>(null)
  const [message, setMessage] = useState('')
  const [saving, setSaving] = useState(false)
  const [refreshCounts, setRefreshCounts] = useState(0)
  const [pending, setPending] = useState<number | null>(null)
  const codeInput = useRef<HTMLInputElement>(null)

  useEffect(() => {
    if (!runtime) return
    void runtime.masters.getMetadata(runtime.context.inventoryId).then((metadata) => setMasterAvailable(Boolean(metadata))).catch(() => setMasterAvailable(false))
  }, [runtime])

  useEffect(() => {
    if (!runtime) return
    let active = true
    void runtime.counts.getOrCreateDeviceId()
      .then((deviceId) => runtime.counts.countPendingByDevice(deviceId))
      .then((total) => { if (active) setPending(total) })
      .catch(() => { if (active) setMessage('No fue posible leer la capacidad local. El guardado permanece bloqueado.') })
    return () => { active = false }
  }, [runtime, refreshCounts])

  useEffect(() => {
    let active = true
    let unsubscribe: (() => Promise<void>) | undefined
    const applyRestoredResult = (result: { field: ScanField | null; value: string | null; error: string | null }) => {
      if (!active || !runtime) return
      // The event processor persists a recovery result for a cold start; once
      // this live form consumes it, remove the duplicate copy.
      consumeRestoredScannerResult()
      if (result.error) { setMessage(result.error); return }
      if (!result.field || !result.value) return
      if (result.field === 'codigo') void resolveSku(result.value)
      else setDraft((current) => ({ ...current, [result.field!]: result.value! }))
    }
    if (runtime) {
      const recovered = consumeRestoredScannerResult()
      if (recovered) applyRestoredResult(recovered)
    }
    void subscribeToScannerRestoration(applyRestoredResult).then((remove) => { unsubscribe = remove })
    return () => { active = false; if (unsubscribe) void unsubscribe() }
  // The runtime controls the authorized inventory; scanner recovery must not outlive it.
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [runtime])

  if (!runtime) return <section className="counting-screen" aria-labelledby="counting-title"><p className="eyebrow">Fase 3</p><h1 id="counting-title">CONTEO FÍSICO</h1><p role="status">Seleccione un inventario ABIERTO desde el contexto autenticado para iniciar la captura offline.</p></section>
  const activeRuntime = runtime
  const capacity = pending === null ? null : pendingCapacity(pending)
  const disabled = masterAvailable !== true || saving || pending === null || capacity === 'BLOCKED'

  async function resolveSku(code = draft.codigo) {
    const resolution = await resolveCountSku(activeRuntime.context.inventoryId, code, draft, activeRuntime.masters)
    setMaster(resolution.master)
    setDraft(resolution.draft)
    setMessage(resolution.error ?? '')
  }
  function updateCode(value: string) {
    setMaster(null)
    setDraft((current) => ({ ...current, codigo: value }))
  }
  async function scan(field: ScanField) {
    const result = await scanBarcodeField(field)
    if (result.error) { setMessage(result.error); return }
    if (!result.value) return
    if (field === 'codigo') await resolveSku(result.value)
    else setDraft((current) => ({ ...current, [field]: result.value! }))
  }
  async function save() {
    if (capacity === 'BLOCKED') { setMessage('Se alcanzó el límite de 50 conteos pendientes en este dispositivo. Sincronice antes de continuar.'); return }
    setSaving(true); setMessage('')
    try {
      const { savePhysicalCount } = await import('../../domain/count/save-physical-count')
      const saved = await savePhysicalCount(activeRuntime.context, draft, activeRuntime)
      setMessage('CONTEO GUARDADO')
      setPending(saved.pending)
      setDraft((current) => resetAfterSuccessfulSave(current))
      setMaster(null)
      setRefreshCounts((value) => value + 1)
      requestAnimationFrame(() => codeInput.current?.focus())
    } catch (error: unknown) {
      setMessage(error instanceof PhysicalCountValidationError || error instanceof Error ? error.message : 'No fue posible guardar localmente. Sus datos siguen en el formulario.')
    } finally { setSaving(false) }
  }

  return <section className="counting-screen" aria-labelledby="counting-title">
    <p className="eyebrow">Offline-first · Inventario ABIERTO</p><h1 id="counting-title">CONTEO FÍSICO</h1>
    {masterAvailable === false && <p className="form-error" role="alert">No existe un maestro SKU disponible en este dispositivo. Actualice el maestro antes de iniciar el conteo.</p>}
    <CapacityStatus pending={pending} capacity={capacity} />
    {message && <p className={message === 'CONTEO GUARDADO' ? 'form-success' : 'form-error'} role="status">{message}</p>}
    <div className="counting-form" aria-disabled={disabled}>
      <Field label="UBICACION"><TextInput value={draft.ubicacion} onChange={(value) => setDraft((current) => ({ ...current, ubicacion: value }))} disabled={disabled} /><ScanButton field="ubicacion" onScan={scan} disabled={disabled} /></Field>
      <Field label="CODIGO"><TextInput inputRef={codeInput} value={draft.codigo} onChange={updateCode} onBlur={() => void resolveSku()} disabled={disabled} /><ScanButton field="codigo" onScan={scan} disabled={disabled} /></Field>
      <Field label="SERIE"><TextInput value={draft.serie ?? ''} onChange={(value) => setDraft((current) => ({ ...current, serie: value }))} disabled={disabled || master?.controlType === 'PARTIDA'} maxLength={19} /><ScanButton field="serie" onScan={scan} disabled={disabled || master?.controlType === 'PARTIDA'} /></Field>
      <Field label="PARTIDA"><TextInput value={draft.partida ?? ''} onChange={(value) => setDraft((current) => ({ ...current, partida: value }))} disabled={disabled || master?.controlType === 'SERIAL'} /><ScanButton field="partida" onScan={scan} disabled={disabled || master?.controlType === 'SERIAL'} /></Field>
      <Field label="PIEZA DEL PRODUCTO"><TextInput value={draft.piezaProducto ?? ''} onChange={(value) => setDraft((current) => ({ ...current, piezaProducto: value }))} disabled={disabled} /></Field>
      <Field label="FECHA DE VENCIMIENTO"><input type="date" value={draft.fechaVencimiento ?? ''} onChange={(event) => setDraft((current) => ({ ...current, fechaVencimiento: event.target.value }))} disabled={disabled} /></Field>
      <Field label="Talla del producto"><TextInput value={draft.talla ?? ''} onChange={(value) => setDraft((current) => ({ ...current, talla: value }))} disabled={disabled} /></Field>
      <Field label="Color del Producto"><TextInput value={draft.color ?? ''} onChange={(value) => setDraft((current) => ({ ...current, color: value }))} disabled={disabled} /></Field>
      <Field label="Cantidad Contada"><TextInput value={master?.controlType === 'SERIAL' ? '1' : draft.cantidadContada} onChange={(value) => setDraft((current) => ({ ...current, cantidadContada: value }))} disabled={disabled || master?.controlType === 'SERIAL'} inputMode="numeric" /></Field>
      <Field label="DESCRIPCION"><textarea value={master?.descripcion ?? ''} readOnly aria-readonly="true" rows={3} placeholder="Se completa desde el maestro local" /></Field>
    </div>
    <button className="button-primary counting-save" type="button" disabled={disabled} onClick={() => void save()}>{saving ? 'GUARDANDO…' : 'GUARDAR CONTEO'}</button>
    <MyCounts runtime={activeRuntime} refreshKey={refreshCounts} />
  </section>
}

function Field({ label, children }: { label: string; children: ReactNode }) { return <label className="field"><span>{label}</span><span className="field__controls">{children}</span></label> }
function TextInput({ value, onChange, onBlur, disabled, maxLength, inputMode, inputRef }: { value: string; onChange: (value: string) => void; onBlur?: () => void; disabled: boolean; maxLength?: number; inputMode?: 'numeric'; inputRef?: RefObject<HTMLInputElement | null> }) { return <input ref={inputRef} value={value} onChange={(event) => onChange(event.target.value)} onBlur={onBlur} disabled={disabled} maxLength={maxLength} inputMode={inputMode} /> }
function ScanButton({ field, onScan, disabled }: { field: ScanField; onScan: (field: ScanField) => Promise<void>; disabled: boolean }) { return <button type="button" className="button-secondary" disabled={disabled} aria-label={`Escanear ${field}`} onClick={() => void onScan(field)}>ESCANEAR</button> }

function MyCounts({ runtime, refreshKey }: { runtime: CountingRuntime; refreshKey: number }) {
  const [search, setSearch] = useState('')
  const [counts, setCounts] = useState<LocalCountRecord[]>([])
  useEffect(() => { void runtime.counts.listOwnCounts({ inventoryId: runtime.context.inventoryId, userId: runtime.context.userId, search }).then(setCounts) }, [runtime, search, refreshKey])
  return <section className="my-counts" aria-labelledby="my-counts-title"><h2 id="my-counts-title">MIS CONTEOS</h2><label className="field"><span>Buscar por código, serie, partida o ubicación</span><input value={search} onChange={(event) => setSearch(event.target.value)} /></label><ul>{counts.map((count) => <li key={count.clientCountId}><time>{new Date(count.capturedAt).toLocaleTimeString()}</time><strong>{count.ubicacion}</strong><span>{count.codigo} · {count.descripcion}</span><span>{count.serie ?? count.partida ?? 'Sin serie/partida'} · {count.cantidadContada}</span><em>Pendiente de sincronización</em></li>)}</ul>{counts.length === 0 && <p>No hay conteos locales para este inventario.</p>}</section>
}

function CapacityStatus({ pending, capacity }: { pending: number | null; capacity: PendingCapacity | null }) {
  if (pending === null) return <p role="status">Comprobando capacidad local…</p>
  const status = getCapacityStatus(pending)
  if (capacity === 'BLOCKED' || capacity === 'CRITICAL') return <p className="form-error" role="alert">{status.message}</p>
  if (capacity === 'WARNING') return <p className="form-warning" role="status">{status.message}</p>
  return <p role="status">{status.message}</p>
}
