import { useEffect, useMemo, useState } from 'react'
import { ArtifactPanel } from '../rectifications/artifact-panel'
import { RectificationPanel } from '../rectifications/rectification-panel'
import type { ArtifactGeneration, CutItem, CutRectification, RectificationsRepository } from '../rectifications/contracts'
import { isSupabaseConfigured } from '../../services/supabase'
import { SupabaseCutsRepository, type PhysicalCorrection } from '../../services/supabase-cuts-repository'
import { SupabaseRectificationsRepository } from '../../services/supabase-rectifications-repository'

const repository = new SupabaseCutsRepository()
const rectificationRepository = new SupabaseRectificationsRepository()
type Inventory = { id: string; name: string; status: string }
type Profile = { role: 'CONTADOR' | 'ANALISTA' | 'ADMIN' }
const blankCorrection: PhysicalCorrection = { ubicacion: '', codigo: '', cantidad_contada: 1 }

export function CutsScreen({ cutsRepository = repository, rectificationsRepository = rectificationRepository }: { cutsRepository?: SupabaseCutsRepository; rectificationsRepository?: RectificationsRepository }) {
  const [inventories, setInventories] = useState<Inventory[]>([])
  const [profile, setProfile] = useState<Profile | null>(null)
  const [inventoryId, setInventoryId] = useState('')
  const [cuts, setCuts] = useState<Record<string, unknown>[]>([])
  const [items, setItems] = useState<Record<string, unknown>[]>([])
  const [selectedCutId, setSelectedCutId] = useState<string | null>(null)
  const [nextItemCursor, setNextItemCursor] = useState<number | null>(null)
  const [message, setMessage] = useState(isSupabaseConfigured ? 'Cargando cortes autorizados…' : 'Cortes no configurados.')
  const [requestId, setRequestId] = useState('')
  const [creating, setCreating] = useState(false)
  const [generatingCutId, setGeneratingCutId] = useState<string | null>(null)
  const [countId, setCountId] = useState('')
  const [context, setContext] = useState<Record<string, unknown> | null>(null)
  const [correction, setCorrection] = useState<PhysicalCorrection>(blankCorrection)
  const [reason, setReason] = useState('')
  const [rectifications, setRectifications] = useState<CutRectification[]>([])
  const [artifacts, setArtifacts] = useState<ArtifactGeneration[]>([])
  const [inventoryArtifacts, setInventoryArtifacts] = useState<ArtifactGeneration[]>([])
  const isManager = profile?.role === 'ANALISTA' || profile?.role === 'ADMIN'
  const selected = useMemo(() => inventories.find((inventory) => inventory.id === inventoryId), [inventories, inventoryId])
  const selectedCut = useMemo(() => cuts.find((cut) => String(cut.id) === selectedCutId) ?? null, [cuts, selectedCutId])

  useEffect(() => {
    if (!isSupabaseConfigured) return
    void Promise.all([cutsRepository.inventories(), cutsRepository.myProfile()]).then(([nextInventories, nextProfile]) => {
      setInventories(nextInventories as Inventory[]); setInventoryId(nextInventories[0]?.id ?? ''); setProfile(nextProfile as Profile); setMessage(nextInventories.length ? '' : 'No existen inventarios autorizados.')
    }).catch((error: unknown) => setMessage(error instanceof Error ? error.message : 'Cortes no disponibles.'))
  }, [cutsRepository])
  useEffect(() => { if (inventoryId && isManager) void refreshCuts() // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [inventoryId, isManager])

  async function refreshCuts() {
    try { setCuts(await cutsRepository.cuts(inventoryId)); setMessage('') } catch (error) { setMessage(error instanceof Error ? error.message : 'Cortes no disponibles.') }
  }
  async function makeCut() {
    if (!inventoryId || !isManager || creating) return
    if (!window.confirm('El corte congelará todos los conteos actualmente recibidos y aún no cortados. Los conteos que lleguen después quedarán para el siguiente corte.')) return
    const stableRequestId = requestId || crypto.randomUUID()
    setRequestId(stableRequestId); setCreating(true)
    try { const cut = await cutsRepository.createCut(inventoryId, stableRequestId); setMessage(`Corte ${String(cut.cut_number)} creado: ${String(cut.record_count)} registros congelados.`); setRequestId(''); await refreshCuts() } catch (error) { setMessage(error instanceof Error ? error.message : 'No fue posible crear el corte. Reintente: la misma solicitud es idempotente.') } finally { setCreating(false) }
  }
  async function showItems(cutId: string) {
    try {
      const page = await cutsRepository.items(cutId)
      setSelectedCutId(cutId); setItems(page); setNextItemCursor(page.length === 100 ? itemExportSeq(page.at(-1)) : null); setMessage('')
      const cut = cuts.find((item) => String(item.id) === cutId)
      if (isManager && String(cut?.status) === 'READY') await refreshF8(cutId)
    } catch (error) { setMessage(error instanceof Error ? error.message : 'Detalle no disponible.') }
  }
  async function refreshF8(cutId = selectedCutId) {
    if (!inventoryId || !cutId || !isManager) return
    try {
      const [nextRectifications, nextArtifacts, allInventoryArtifacts] = await Promise.all([
        rectificationsRepository.rectifications(cutId),
        rectificationsRepository.artifacts(inventoryId, cutId),
        profile?.role === 'ADMIN' && selected?.status === 'CONGELADO' ? rectificationsRepository.artifacts(inventoryId) : Promise.resolve([]),
      ])
      setRectifications(nextRectifications); setArtifacts(nextArtifacts); setInventoryArtifacts(allInventoryArtifacts)
    } catch (error) { setMessage(error instanceof Error ? error.message : 'Evidencias no disponibles.') }
  }
  async function refreshF8AndCuts() { await Promise.all([refreshCuts(), refreshF8()]) }
  async function loadMoreItems() {
    if (!selectedCutId || nextItemCursor === null) return
    try {
      const page = await cutsRepository.items(selectedCutId, nextItemCursor)
      setItems((current) => [...current, ...page]); setNextItemCursor(page.length === 100 ? itemExportSeq(page.at(-1)) : null); setMessage('')
    } catch (error) { setMessage(error instanceof Error ? error.message : 'No fue posible cargar más snapshots.') }
  }
  async function generateRp(cutId: string) {
    if (generatingCutId) return
    setGeneratingCutId(cutId)
    try { const result = await cutsRepository.generateRpXlsx(cutId, crypto.randomUUID()); setMessage(result.action === 'READY' ? 'El archivo RP ya estaba listo.' : 'Archivo RP generado, validado y listo para descargar.'); await refreshCuts() } catch (error) { setMessage(error instanceof Error ? error.message : 'La generación RP falló de forma segura. Reintente.') } finally { setGeneratingCutId(null) }
  }
  async function downloadRp(cutId: string) {
    try { const file = await cutsRepository.downloadRpXlsx(cutId); window.open(file.signedUrl, '_blank', 'noopener,noreferrer'); setMessage(`Descarga autorizada: ${file.fileName}`) } catch (error) { setMessage(error instanceof Error ? error.message : 'Descarga RP no disponible.') }
  }
  async function loadCorrection() {
    try {
      const next = await cutsRepository.correctionContext(countId); const count = next.count as Record<string, unknown>
      setContext(next); setCorrection({ ubicacion: String(count.ubicacion ?? ''), codigo: String(count.codigo ?? ''), serie: text(count.serie), partida: text(count.partida), pieza_producto: text(count.pieza_producto), fecha_vencimiento: text(count.fecha_vencimiento), talla: text(count.talla), color: text(count.color), cantidad_contada: Number(count.cantidad_contada ?? 1) }); setMessage('')
    } catch (error) { setMessage(error instanceof Error ? error.message : 'Registro no disponible.') }
  }
  async function saveCorrection() {
    try { const result = await cutsRepository.correct(countId, correction, reason); setMessage(`Corrección guardada como revisión ${String(result.revision_number)}.`); setReason(''); await loadCorrection() } catch (error) { setMessage(error instanceof Error ? error.message : 'Corrección rechazada por el servidor.') }
  }
  function update(key: keyof PhysicalCorrection, value: string) { setCorrection((current) => ({ ...current, [key]: key === 'cantidad_contada' ? Number(value) : value })) }

  return <section className="cuts-screen" aria-labelledby="cuts-title">
    <header><p className="eyebrow">Fases 6–8 · snapshot y evidencia</p><h1 id="cuts-title">CORTES</h1><p>Un corte no es un cierre: sólo congela los conteos que el servidor ya recibió.</p></header>
    {message && <p className="form-warning" role="status">{message}</p>}
    <label className="field"><span>Inventario</span><select value={inventoryId} onChange={(event) => { setInventoryId(event.target.value); setItems([]); setSelectedCutId(null); setNextItemCursor(null) }}>{inventories.map((item) => <option value={item.id} key={item.id}>{item.name} · {item.status}</option>)}</select></label>
    {isManager ? <><button className="button-primary cuts-create" type="button" disabled={!inventoryId || creating || !selected || !['ABIERTO', 'CERRADO'].includes(selected.status)} onClick={() => void makeCut()}>{creating ? 'CREANDO CORTE…' : 'HACER CORTE'}</button><p className="cuts-note">La misma solicitud conserva su identificador mientras está en curso; el servidor también evita duplicados.</p><h2>Historial de cortes</h2><ul className="cuts-list">{cuts.map((cut) => <li key={String(cut.id)}><strong>CORTE {String(cut.cut_number).padStart(3, '0')} · {String(cut.status)}</strong><span>{String(cut.record_count)} registros · EXPORT_SEQ {String(cut.first_export_seq)}–{String(cut.last_export_seq)}</span><button className="button-secondary" type="button" onClick={() => void showItems(String(cut.id))}>VER DETALLE</button>{String(cut.status) === 'SNAPSHOT_CREATED' && <button className="button-primary" type="button" disabled={generatingCutId !== null} onClick={() => void generateRp(String(cut.id))}>{generatingCutId === String(cut.id) ? 'GENERANDO RP…' : 'GENERAR RP XLSX'}</button>}{['FILE_GENERATED','VALIDATED'].includes(String(cut.status)) && <span className="cuts-note">Procesamiento RP recuperable en curso.</span>}{String(cut.status) === 'READY' && <button className="button-primary" type="button" onClick={() => void downloadRp(String(cut.id))}>DESCARGAR RP XLSX</button>}</li>)}</ul>{items.length > 0 && <section className="cut-detail"><h2>Detalle inmutable</h2><ul>{items.map((item) => <li key={String(item.count_record_id)}>#{String(item.export_seq)} · {String((item.snapshot as Record<string, unknown>).codigo)} · {String((item.snapshot as Record<string, unknown>).cantidad_contada)}</li>)}</ul>{nextItemCursor !== null && <button className="button-secondary" type="button" onClick={() => void loadMoreItems()}>CARGAR MÁS</button>}</section>}{selectedCut && String(selectedCut.status) === 'READY' && <><RectificationPanel inventoryId={inventoryId} cut={{ id: String(selectedCut.id), cut_number: Number(selectedCut.cut_number), status: String(selectedCut.status) }} items={items as CutItem[]} rectifications={rectifications} role={profile!.role} repository={rectificationsRepository} onChanged={refreshF8AndCuts} /><ArtifactPanel artifacts={artifacts} finalArtifacts={inventoryArtifacts} rectifications={rectifications} role={profile!.role} inventoryFrozen={selected?.status === 'CONGELADO'} repository={rectificationsRepository} onChanged={refreshF8AndCuts} /></>}</> : <p className="cuts-note">CONTADOR no puede hacer ni listar cortes ni gestionar evidencias F8.</p>}
    <section className="correction-panel"><h2>Corrección pre-corte</h2><p>Disponible sólo para un registro propio no cortado, o para gestión autorizada. Los registros ya cortados requieren una fase posterior de rectificación.</p><label className="field"><span>ID del registro recibido</span><input value={countId} onChange={(event) => setCountId(event.target.value)} /></label><button className="button-secondary" type="button" disabled={!countId} onClick={() => void loadCorrection()}>CARGAR REGISTRO</button>{context && <CorrectionForm correction={correction} update={update} reason={reason} setReason={setReason} onSave={saveCorrection} revisions={(context.revisions as Record<string, unknown>[]) ?? []} />}</section>
  </section>
}

function CorrectionForm({ correction, update, reason, setReason, onSave, revisions }: { correction: PhysicalCorrection; update: (key: keyof PhysicalCorrection, value: string) => void; reason: string; setReason: (value: string) => void; onSave: () => Promise<void>; revisions: Record<string, unknown>[] }) {
  const fields: (keyof PhysicalCorrection)[] = ['ubicacion', 'codigo', 'serie', 'partida', 'pieza_producto', 'fecha_vencimiento', 'talla', 'color', 'cantidad_contada']
  return <div className="correction-form">{fields.map((key) => <label className="field" key={key}><span>{key.replaceAll('_', ' ').toUpperCase()}</span><input type={key === 'cantidad_contada' ? 'number' : key === 'fecha_vencimiento' ? 'date' : 'text'} min={key === 'cantidad_contada' ? 1 : undefined} value={String(correction[key] ?? '')} onChange={(event) => update(key, event.target.value)} /></label>)}<label className="field"><span>MOTIVO OBLIGATORIO</span><textarea value={reason} onChange={(event) => setReason(event.target.value)} maxLength={500} /></label><button className="button-primary" type="button" disabled={!reason.trim()} onClick={() => void onSave()}>GUARDAR CORRECCIÓN</button><h3>Revisiones</h3><ul>{revisions.length ? revisions.map((revision) => <li key={String(revision.id)}>V{String(revision.revision_number)} · {String(revision.reason)} · {String(revision.created_at)}</li>) : <li>Sin revisiones anteriores.</li>}</ul></div>
}
function text(value: unknown) { return value === null || value === undefined ? '' : String(value) }
function itemExportSeq(item: Record<string, unknown> | undefined) { return item && typeof item.export_seq === 'number' ? item.export_seq : null }
