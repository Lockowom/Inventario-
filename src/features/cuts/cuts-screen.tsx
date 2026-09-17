import { useEffect, useMemo, useState } from 'react'
import { isSupabaseConfigured } from '../../services/supabase'
import { SupabaseCutsRepository, type PhysicalCorrection } from '../../services/supabase-cuts-repository'

const repository = new SupabaseCutsRepository()
type Inventory = { id: string; name: string; status: string }
type Profile = { role: 'CONTADOR' | 'ANALISTA' | 'ADMIN' }
const blankCorrection: PhysicalCorrection = { ubicacion: '', codigo: '', cantidad_contada: 1 }

export function CutsScreen() {
  const [inventories, setInventories] = useState<Inventory[]>([])
  const [profile, setProfile] = useState<Profile | null>(null)
  const [inventoryId, setInventoryId] = useState('')
  const [cuts, setCuts] = useState<Record<string, unknown>[]>([])
  const [items, setItems] = useState<Record<string, unknown>[]>([])
  const [message, setMessage] = useState(isSupabaseConfigured ? 'Cargando cortes autorizados…' : 'Cortes no configurados.')
  const [requestId, setRequestId] = useState('')
  const [creating, setCreating] = useState(false)
  const [countId, setCountId] = useState('')
  const [context, setContext] = useState<Record<string, unknown> | null>(null)
  const [correction, setCorrection] = useState<PhysicalCorrection>(blankCorrection)
  const [reason, setReason] = useState('')
  const isManager = profile?.role === 'ANALISTA' || profile?.role === 'ADMIN'
  const selected = useMemo(() => inventories.find((inventory) => inventory.id === inventoryId), [inventories, inventoryId])

  useEffect(() => {
    if (!isSupabaseConfigured) return
    void Promise.all([repository.inventories(), repository.myProfile()]).then(([nextInventories, nextProfile]) => {
      setInventories(nextInventories as Inventory[]); setInventoryId(nextInventories[0]?.id ?? ''); setProfile(nextProfile as Profile); setMessage(nextInventories.length ? '' : 'No existen inventarios autorizados.')
    }).catch((error: unknown) => setMessage(error instanceof Error ? error.message : 'Cortes no disponibles.'))
  }, [])
  useEffect(() => { if (inventoryId && isManager) void refreshCuts() // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [inventoryId, isManager])

  async function refreshCuts() {
    try { setCuts(await repository.cuts(inventoryId)); setMessage('') } catch (error) { setMessage(error instanceof Error ? error.message : 'Cortes no disponibles.') }
  }
  async function makeCut() {
    if (!inventoryId || !isManager || creating) return
    if (!window.confirm('El corte congelará todos los conteos actualmente recibidos y aún no cortados. Los conteos que lleguen después quedarán para el siguiente corte.')) return
    const stableRequestId = requestId || crypto.randomUUID()
    setRequestId(stableRequestId); setCreating(true)
    try { const cut = await repository.createCut(inventoryId, stableRequestId); setMessage(`Corte ${String(cut.cut_number)} creado: ${String(cut.record_count)} registros congelados.`); setRequestId(''); await refreshCuts() } catch (error) { setMessage(error instanceof Error ? error.message : 'No fue posible crear el corte. Reintente: la misma solicitud es idempotente.') } finally { setCreating(false) }
  }
  async function showItems(cutId: string) {
    try { setItems(await repository.items(cutId)); setMessage('') } catch (error) { setMessage(error instanceof Error ? error.message : 'Detalle no disponible.') }
  }
  async function loadCorrection() {
    try {
      const next = await repository.correctionContext(countId); const count = next.count as Record<string, unknown>
      setContext(next); setCorrection({ ubicacion: String(count.ubicacion ?? ''), codigo: String(count.codigo ?? ''), serie: text(count.serie), partida: text(count.partida), pieza_producto: text(count.pieza_producto), fecha_vencimiento: text(count.fecha_vencimiento), talla: text(count.talla), color: text(count.color), cantidad_contada: Number(count.cantidad_contada ?? 1) }); setMessage('')
    } catch (error) { setMessage(error instanceof Error ? error.message : 'Registro no disponible.') }
  }
  async function saveCorrection() {
    try { const result = await repository.correct(countId, correction, reason); setMessage(`Corrección guardada como revisión ${String(result.revision_number)}.`); setReason(''); await loadCorrection() } catch (error) { setMessage(error instanceof Error ? error.message : 'Corrección rechazada por el servidor.') }
  }
  function update(key: keyof PhysicalCorrection, value: string) { setCorrection((current) => ({ ...current, [key]: key === 'cantidad_contada' ? Number(value) : value })) }

  return <section className="cuts-screen" aria-labelledby="cuts-title">
    <header><p className="eyebrow">Fase 6 · snapshot transaccional</p><h1 id="cuts-title">CORTES</h1><p>Un corte no es un cierre: sólo congela los conteos que el servidor ya recibió.</p></header>
    {message && <p className="form-warning" role="status">{message}</p>}
    <label className="field"><span>Inventario</span><select value={inventoryId} onChange={(event) => { setInventoryId(event.target.value); setItems([]) }}>{inventories.map((item) => <option value={item.id} key={item.id}>{item.name} · {item.status}</option>)}</select></label>
    {isManager ? <><button className="button-primary cuts-create" type="button" disabled={!inventoryId || creating || !selected || !['ABIERTO', 'CERRADO'].includes(selected.status)} onClick={() => void makeCut()}>{creating ? 'CREANDO CORTE…' : 'HACER CORTE'}</button><p className="cuts-note">La misma solicitud conserva su identificador mientras está en curso; el servidor también evita duplicados.</p><h2>Historial de cortes</h2><ul className="cuts-list">{cuts.map((cut) => <li key={String(cut.id)}><strong>CORTE {String(cut.cut_number).padStart(3, '0')} · {String(cut.status)}</strong><span>{String(cut.record_count)} registros · EXPORT_SEQ {String(cut.first_export_seq)}–{String(cut.last_export_seq)}</span><button className="button-secondary" type="button" onClick={() => void showItems(String(cut.id))}>VER DETALLE</button></li>)}</ul>{items.length > 0 && <section className="cut-detail"><h2>Detalle inmutable</h2><ul>{items.map((item) => <li key={String(item.count_record_id)}>#{String(item.export_seq)} · {String((item.snapshot as Record<string, unknown>).codigo)} · {String((item.snapshot as Record<string, unknown>).cantidad_contada)}</li>)}</ul></section>}</> : <p className="cuts-note">CONTADOR no puede hacer ni listar cortes.</p>}
    <section className="correction-panel"><h2>Corrección pre-corte</h2><p>Disponible sólo para un registro propio no cortado, o para gestión autorizada. Los registros ya cortados requieren una fase posterior de rectificación.</p><label className="field"><span>ID del registro recibido</span><input value={countId} onChange={(event) => setCountId(event.target.value)} /></label><button className="button-secondary" type="button" disabled={!countId} onClick={() => void loadCorrection()}>CARGAR REGISTRO</button>{context && <CorrectionForm correction={correction} update={update} reason={reason} setReason={setReason} onSave={saveCorrection} revisions={(context.revisions as Record<string, unknown>[]) ?? []} />}</section>
  </section>
}

function CorrectionForm({ correction, update, reason, setReason, onSave, revisions }: { correction: PhysicalCorrection; update: (key: keyof PhysicalCorrection, value: string) => void; reason: string; setReason: (value: string) => void; onSave: () => Promise<void>; revisions: Record<string, unknown>[] }) {
  const fields: (keyof PhysicalCorrection)[] = ['ubicacion', 'codigo', 'serie', 'partida', 'pieza_producto', 'fecha_vencimiento', 'talla', 'color', 'cantidad_contada']
  return <div className="correction-form">{fields.map((key) => <label className="field" key={key}><span>{key.replaceAll('_', ' ').toUpperCase()}</span><input type={key === 'cantidad_contada' ? 'number' : key === 'fecha_vencimiento' ? 'date' : 'text'} min={key === 'cantidad_contada' ? 1 : undefined} value={String(correction[key] ?? '')} onChange={(event) => update(key, event.target.value)} /></label>)}<label className="field"><span>MOTIVO OBLIGATORIO</span><textarea value={reason} onChange={(event) => setReason(event.target.value)} maxLength={500} /></label><button className="button-primary" type="button" disabled={!reason.trim()} onClick={() => void onSave()}>GUARDAR CORRECCIÓN</button><h3>Revisiones</h3><ul>{revisions.length ? revisions.map((revision) => <li key={String(revision.id)}>V{String(revision.revision_number)} · {String(revision.reason)} · {String(revision.created_at)}</li>) : <li>Sin revisiones anteriores.</li>}</ul></div>
}
function text(value: unknown) { return value === null || value === undefined ? '' : String(value) }
