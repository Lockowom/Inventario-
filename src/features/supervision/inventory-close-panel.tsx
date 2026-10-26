import { useCallback, useEffect, useRef, useState, type KeyboardEvent as ReactKeyboardEvent } from 'react'
import type { InventoryClosePreview, InventoryCloseResult } from '../../domain/inventory-close/contracts'
import { SupabaseInventoryCloseRepository } from '../../services/supabase-inventory-close-repository'

type CloseRepository = Pick<SupabaseInventoryCloseRepository, 'previewInventoryClose' | 'closeInventoryFinal'>

const defaultRepository = new SupabaseInventoryCloseRepository()

const blockerLabels: Record<string, string> = {
  INVALID_LIFECYCLE: 'El inventario no está abierto.', C1_NOT_FINALIZED: 'C1 aún no está finalizado.',
  PENDING_SYNC_GUARD: 'Hay sincronizaciones pendientes.', OPEN_RECONCILIATION_CASE: 'Hay casos de conciliación abiertos.',
  OPEN_C2: 'Hay reconteos C2 abiertos.', OPEN_C3: 'Hay reconteos C3 abiertos.',
  FINDING_BLOCKS_CLOSE: 'Hay hallazgos que bloquean el cierre.', UNRESOLVED_OFFLINE_REVIEW: 'Hay evidencia offline pendiente de revisión.',
  UNSEALED_REFERENCE: 'Hay referencias sin sellar.', ORPHAN_REFERENCE_OPEN: 'Hay referencias huérfanas abiertas.',
  IDENTITY_CONFLICT: 'Hay conflictos de identidad.', UOM_CONFLICT: 'Hay conflictos de unidad de medida.',
  NEGATIVE_QUANTITY: 'Hay cantidades físicas no válidas.', RP_REFERENCE_OMITTED: 'Hay referencias RP pendientes.',
  RP_RELEASE_DRAFT: 'Hay liberaciones RP en borrador.', RP_RELEASE_INTEGRITY_FAILURE: 'Hay liberaciones RP con error de integridad.',
  RECTIFICATION_CHAIN_OPEN: 'Hay rectificaciones pendientes.', DISCARD_PENDING: 'Hay descartes pendientes.',
}

const blockerHints: Record<string, string> = {
  OPEN_C2: 'Complete o gestione los reconteos C2 desde Reconteos.',
  OPEN_C3: 'Complete o gestione los reconteos C3 desde Reconteos.',
  FINDING_BLOCKS_CLOSE: 'Revise y resuelva los hallazgos bloqueantes.',
  UNRESOLVED_OFFLINE_REVIEW: 'Revise la evidencia offline pendiente.',
  RP_REFERENCE_OMITTED: 'Complete la cobertura RP de las referencias elegibles.',
  RP_RELEASE_DRAFT: 'Valide el manifiesto RP o descarte el borrador según corresponda.',
  C1_NOT_FINALIZED: 'Finalice C1 antes de solicitar el cierre final.',
}

function humanError(error: unknown) {
  const text = error instanceof Error ? error.message : 'No fue posible completar el cierre.'
  if (text.includes('PREVIEW_STALE')) return 'El estado del inventario cambió desde la última revisión. Actualiza la previsualización.'
  if (text.includes('INVENTORY_NOT_READY')) return 'El inventario todavía tiene bloqueos. Actualiza la previsualización para ver el estado actual.'
  if (text.includes('INVENTORY_ALREADY_CLOSED')) return 'El inventario ya está cerrado.'
  if (text.includes('CAPABILITY_REQUIRED') || text.includes('SCOPE_DENIED') || text.includes('permission denied')) return 'No tienes autorización para cerrar este inventario.'
  return text
}

export function InventoryClosePanel({ inventoryId, onChanged, repository = defaultRepository }: {
  inventoryId: string
  onChanged: () => Promise<void> | void
  repository?: CloseRepository
}) {
  const [preview, setPreview] = useState<InventoryClosePreview | null>(null)
  const [loading, setLoading] = useState(false)
  const [closing, setClosing] = useState(false)
  const [confirming, setConfirming] = useState(false)
  const [message, setMessage] = useState('')
  const [result, setResult] = useState<InventoryCloseResult | null>(null)
  const confirmRef = useRef<HTMLButtonElement>(null)
  const openConfirmRef = useRef<HTMLButtonElement>(null)
  const dialogRef = useRef<HTMLElement>(null)
  const closeInFlight = useRef(false)

  const refresh = useCallback(async () => {
    if (!inventoryId) return
    setLoading(true); setMessage('')
    try {
      const next = await repository.previewInventoryClose(inventoryId)
      setPreview(next)
      if (next.current_status === 'CERRADO') setMessage('El inventario está cerrado. Las operaciones incompatibles ya están bloqueadas.')
    } catch (error) { setPreview(null); setMessage(humanError(error)) }
    finally { setLoading(false) }
  }, [inventoryId, repository])

  useEffect(() => { setPreview(null); setResult(null); setConfirming(false); setMessage('') }, [inventoryId])
  useEffect(() => { if (confirming) confirmRef.current?.focus() }, [confirming])
  useEffect(() => {
    if (!confirming) return
    const cancelOnEscape = (event: KeyboardEvent) => {
      if (event.key === 'Escape' && !closing) setConfirming(false)
    }
    window.addEventListener('keydown', cancelOnEscape)
    return () => window.removeEventListener('keydown', cancelOnEscape)
  }, [closing, confirming])
  useEffect(() => {
    if (!confirming) openConfirmRef.current?.focus()
  }, [confirming])

  async function close() {
    if (!preview?.is_ready || closing || closeInFlight.current) return
    closeInFlight.current = true
    setClosing(true); setMessage('')
    try {
      const next = await repository.closeInventoryFinal(inventoryId, preview.fingerprint, crypto.randomUUID())
      setResult(next); setConfirming(false)
      await onChanged()
      setPreview((current) => current ? { ...current, current_status: 'CERRADO', is_ready: false } : current)
      setMessage('Inventario cerrado correctamente. No se realizaron ajustes ERP ni modificaciones de stock.')
    } catch (error) {
      const nextMessage = humanError(error)
      setConfirming(false)
      if (/cambió|bloqueos|cerrado/.test(nextMessage)) await refresh()
      setMessage(nextMessage)
    } finally { closeInFlight.current = false; setClosing(false) }
  }

  function retainDialogFocus(event: ReactKeyboardEvent<HTMLElement>) {
    if (event.key !== 'Tab') return
    const controls = Array.from(dialogRef.current?.querySelectorAll<HTMLButtonElement>('button:not([disabled])') ?? [])
    if (controls.length === 0) return
    const first = controls[0]!; const last = controls[controls.length - 1]!
    if (event.shiftKey && document.activeElement === first) { event.preventDefault(); last.focus() }
    if (!event.shiftKey && document.activeElement === last) { event.preventDefault(); first.focus() }
  }

  const closed = preview?.current_status === 'CERRADO' || result?.status === 'CERRADO'
  return <section className="inventory-close" aria-labelledby="inventory-close-title">
    <header className="inventory-close__header"><div><p className="eyebrow">CUT2-10 · transición final</p><h2 id="inventory-close-title">CIERRE DE INVENTARIO</h2></div><strong>{closed ? 'CERRADO' : preview?.is_ready ? 'LISTO' : 'REVISAR'}</strong></header>
    <p>El servidor determina la preparación y valida cada cierre. Esta operación no ajusta ERP, no modifica stock y no genera XLSX ni una liberación RP.</p>
    <div className="inventory-close__actions"><button className="button-secondary" type="button" onClick={() => void refresh()} disabled={loading || closing}>{loading ? 'ACTUALIZANDO…' : preview ? 'ACTUALIZAR PREVISUALIZACIÓN' : 'REVISAR CIERRE'}</button>{preview?.is_ready && !closed && <button ref={openConfirmRef} className="button-primary" type="button" onClick={() => setConfirming(true)} disabled={loading || closing}>CERRAR INVENTARIO</button>}</div>
    {preview && <Preview readiness={preview} result={result} />}
    {message && <p className="master-message" role="status">{message}</p>}
    {confirming && <div className="inventory-close__backdrop" role="presentation"><section className="inventory-close__dialog" role="dialog" aria-modal="true" aria-labelledby="inventory-close-confirm-title">
    <section ref={dialogRef} onKeyDown={retainDialogFocus}><h3 id="inventory-close-confirm-title">Confirmar cierre final</h3><p>El inventario quedará cerrado y las operaciones incompatibles posteriores serán bloqueadas.</p><p>Esta acción no ajusta ERP, no modifica stock, no genera XLSX y no crea una liberación RP.</p>
      <div><button className="button-secondary" type="button" onClick={() => setConfirming(false)} disabled={closing}>CANCELAR</button><button ref={confirmRef} className="button-primary" type="button" onClick={() => void close()} disabled={closing}>{closing ? 'CERRANDO…' : 'CONFIRMAR CIERRE'}</button></div>
    </section></section></div>}
  </section>
}

function Preview({ readiness, result }: { readiness: InventoryClosePreview; result: InventoryCloseResult | null }) {
  const refreshedAt = new Date().toLocaleString()
  const counts = [
    ['C2 abiertos', readiness.blocker_counts.open_c2_count], ['C3 abiertos', readiness.blocker_counts.open_c3_count],
    ['Hallazgos', readiness.blocker_counts.blocking_findings_count], ['Reviews', readiness.blocker_counts.unresolved_reviews_count],
    ['Sin sellar', readiness.blocker_counts.unsealed_refs_count], ['Huérfanas', readiness.blocker_counts.orphan_refs_count],
    ['RP pendiente', readiness.blocker_counts.rp_pending_refs_count], ['RP draft', readiness.blocker_counts.rp_draft_count],
    ['RP READY', readiness.blocker_counts.rp_ready_count],
  ] as const
  return <div className="inventory-close__preview" role="region" aria-label="Previsualización de cierre">
    <div className={readiness.is_ready ? 'inventory-close__ready' : 'inventory-close__blocked'}><strong>{readiness.is_ready ? 'INVENTARIO LISTO PARA CIERRE' : 'CIERRE BLOQUEADO'}</strong><span>Estado actual: {readiness.current_status} → {readiness.target_status}</span><span>Bloqueos: {readiness.blockers.length}</span></div>
    <dl>{counts.map(([label, value]) => <div key={label}><dt>{label}</dt><dd>{value ?? 0}</dd></div>)}</dl>
    <p className="inventory-close__fingerprint">Huella: <code>{readiness.fingerprint.slice(0, 12)}…</code> · Actualizada: {refreshedAt}</p>
    {result && <p className="inventory-close__result">Resultado: {result.status} · solicitud <code>{result.close_request_id.slice(0, 8)}…</code></p>}
    {!readiness.is_ready && <ul className="inventory-close__blockers">{readiness.blockers.map((blocker) => <li key={blocker.code}><strong>{blocker.code}</strong><span>{blockerLabels[blocker.code] ?? 'Requiere revisión operacional.'}</span>{blockerHints[blocker.code] && <small>{blockerHints[blocker.code]}</small>}<em>{blocker.count}</em></li>)}</ul>}
  </div>
}
