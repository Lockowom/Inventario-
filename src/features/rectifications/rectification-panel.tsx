import { useEffect, useMemo, useState } from 'react'
import { locationSchema } from '../../domain/validation/location'
import type { CutItem, CutRectification, EvidenceValues, F8Role, MasterItem, PhysicalPayload, RectificationsRepository } from './contracts'

type ReadyCut = { id: string; cut_number: number; status: string }
const physicalFields: Array<keyof PhysicalPayload> = ['ubicacion', 'codigo', 'serie', 'partida', 'pieza_producto', 'fecha_vencimiento', 'talla', 'color', 'cantidad_contada']
const labels: Record<keyof PhysicalPayload | 'descripcion', string> = {
  ubicacion: 'UBICACIÓN', codigo: 'CÓDIGO', serie: 'SERIE', partida: 'PARTIDA', pieza_producto: 'PIEZA DEL PRODUCTO', fecha_vencimiento: 'FECHA DE VENCIMIENTO', talla: 'Talla del producto', color: 'Color del Producto', cantidad_contada: 'Cantidad Contada', descripcion: 'DESCRIPCIÓN',
}

function text(value: unknown) { return value === null || value === undefined ? '' : String(value) }
function physical(values: EvidenceValues): PhysicalPayload {
  return { ubicacion: text(values.ubicacion), codigo: text(values.codigo), serie: text(values.serie), partida: text(values.partida), pieza_producto: text(values.pieza_producto), fecha_vencimiento: text(values.fecha_vencimiento), talla: text(values.talla), color: text(values.color), cantidad_contada: Number(values.cantidad_contada ?? 1) }
}
function effectiveFor(item: CutItem, history: CutRectification[]) { return history.at(-1)?.new_values ?? item.snapshot }

function userMessage(error: unknown) {
  const message = error instanceof Error ? error.message : ''
  if (/IDEMPOTENCY_CONFLICT/i.test(message)) return 'Esta solicitud ya está asociada a otra rectificación. Revise los datos antes de crear una nueva solicitud.'
  if (/not authorized|permission|authorization/i.test(message)) return 'No tiene autorización para rectificar este corte.'
  if (/Cut must be READY/i.test(message)) return 'El corte debe estar LISTO para crear una rectificación.'
  if (/UNKNOWN_SKU/i.test(message)) return 'El código no existe en el maestro autorizado.'
  if (/INVALID_/i.test(message)) return 'Los datos físicos no cumplen las reglas del inventario. Revise los campos marcados.'
  if (/failed to fetch|network|unavailable/i.test(message)) return 'Rectificaciones y evidencias requieren conexión al servidor. No se realizó ningún cambio.'
  return 'La rectificación fue rechazada por el servidor. No se realizó ningún cambio.'
}

function validate(payload: PhysicalPayload, reason: string, master: MasterItem | null) {
  const errors: string[] = []
  if (!locationSchema.safeParse(payload.ubicacion.trim().toUpperCase()).success) errors.push('UBICACIÓN debe respetar el formato contractual, por ejemplo A-01-01.')
  if (!payload.codigo.trim()) errors.push('CÓDIGO es obligatorio.')
  if (payload.serie.length > 19) errors.push('SERIE admite como máximo 19 caracteres.')
  if (!Number.isInteger(payload.cantidad_contada) || payload.cantidad_contada <= 0) errors.push('Cantidad Contada debe ser un entero mayor que cero.')
  if (!reason.trim() || reason.trim().length > 500) errors.push('MOTIVO es obligatorio y admite como máximo 500 caracteres.')
  if (master?.control_type === 'SERIAL' && (!payload.serie.trim() || payload.partida || payload.cantidad_contada !== 1)) errors.push('El artículo SERIAL requiere SERIE, sin PARTIDA y cantidad 1.')
  if (master?.control_type === 'PARTIDA' && (!payload.partida.trim() || payload.serie)) errors.push('El artículo PARTIDA requiere PARTIDA y no admite SERIE.')
  return errors
}

export function RectificationPanel({ inventoryId, cut, items, rectifications, role, repository, onChanged }: { inventoryId: string; cut: ReadyCut; items: CutItem[]; rectifications: CutRectification[]; role: F8Role; repository: RectificationsRepository; onChanged: () => Promise<void> }) {
  const [selectedId, setSelectedId] = useState<string | null>(null)
  const [payload, setPayload] = useState<PhysicalPayload | null>(null)
  const [reason, setReason] = useState('')
  const [requestId, setRequestId] = useState('')
  const [master, setMaster] = useState<MasterItem | null>(null)
  const [saving, setSaving] = useState(false)
  const [notice, setNotice] = useState('')
  const [errors, setErrors] = useState<string[]>([])
  const selected = useMemo(() => items.find((item) => item.count_record_id === selectedId) ?? null, [items, selectedId])
  const history = useMemo(() => selected ? rectifications.filter((row) => row.count_record_id === selected.count_record_id) : [], [rectifications, selected])
  const effective = selected ? effectiveFor(selected, history) : null
  const allowed = cut.status === 'READY' && (role === 'ANALISTA' || role === 'ADMIN')

  useEffect(() => {
    if (!selected || !effective) return
    setPayload(physical(effective)); setReason(''); setRequestId(''); setErrors([]); setNotice('')
  }, [selected, effective])
  useEffect(() => {
    const codigo = payload?.codigo.trim()
    if (!codigo) { setMaster(null); return }
    let current = true
    void repository.masterItem(inventoryId, codigo).then((item) => { if (current) setMaster(item) }).catch(() => { if (current) setMaster(null) })
    return () => { current = false }
  }, [inventoryId, payload?.codigo, repository])

  function select(item: CutItem) { setSelectedId(item.count_record_id) }
  function update(key: keyof PhysicalPayload, value: string) {
    setPayload((current) => {
      if (!current) return current
      const next = { ...current, [key]: key === 'cantidad_contada' ? Number(value) : value }
      if (key === 'codigo') { next.codigo = value.toUpperCase() }
      if (key === 'serie' && master?.control_type === 'SERIAL') next.partida = ''
      if (key === 'partida' && master?.control_type === 'PARTIDA') next.serie = ''
      return next
    })
  }
  async function save() {
    if (!selected || !payload || saving) return
    const nextErrors = validate(payload, reason, master)
    setErrors(nextErrors); setNotice('')
    if (nextErrors.length) return
    if (!requestId && !window.confirm('Se creará una rectificación nueva y auditada. El corte y el archivo RP original permanecerán sin cambios.')) return
    const stableRequestId = requestId || crypto.randomUUID()
    setRequestId(stableRequestId); setSaving(true)
    try {
      const result = await repository.rectifyCut({ cutId: cut.id, countRecordId: selected.count_record_id, physicalPayload: payload, reason: reason.trim(), requestId: stableRequestId })
      setRequestId(''); setNotice(`RECTIFICACIÓN R${String(result.rectification_number).padStart(3, '0')} CREADA`); setReason(''); await onChanged()
    } catch (error) { setNotice(userMessage(error)) } finally { setSaving(false) }
  }

  return <section className="rectification-panel" aria-labelledby="rectification-title">
    <header><p className="eyebrow">Fase 8 · evidencia post-corte</p><h2 id="rectification-title">RECTIFICACIONES</h2><p>El corte original no será modificado. Esta acción crea nueva evidencia auditada.</p></header>
    <ul className="rectification-records" aria-label="Detalle inmutable del corte">
      {items.map((item) => <li key={item.count_record_id}><strong>EXPORT_SEQ {item.export_seq}</strong><span>COUNT_RECORD {item.count_record_id}</span><span>{item.snapshot.codigo} · cantidad {item.snapshot.cantidad_contada}</span>{allowed && <button className="button-secondary" type="button" onClick={() => select(item)}>RECTIFICAR</button>}</li>)}
    </ul>
    {selected && payload && effective && <section className="rectification-workspace" aria-labelledby="post-cut-title">
      <h3 id="post-cut-title">RECTIFICACIÓN POST-CORTE</h3><p className="rectification-identifiers">CORTE {String(cut.cut_number).padStart(3, '0')} · EXPORT_SEQ {selected.export_seq} · COUNT_RECORD {selected.count_record_id}</p>
      <div className="rectification-evidence"><EvidenceCard title="EVIDENCIA DEL CORTE" values={selected.snapshot} /><EvidenceCard title="ESTADO EFECTIVO ACTUAL" values={effective} /></div>
      <History history={history} />
      <fieldset className="rectification-form"><legend>VALORES CORRECTOS</legend><p>El formulario comienza con el último estado efectivo. DESCRIPCIÓN se deriva del maestro y no se envía al servidor.</p>
        {physicalFields.map((key) => <label className="field" key={key}><span>{labels[key]}{(key === 'serie' && master?.control_type === 'SERIAL') || (key === 'partida' && master?.control_type === 'PARTIDA') ? ' · OBLIGATORIO' : ''}</span><input type={key === 'cantidad_contada' ? 'number' : key === 'fecha_vencimiento' ? 'date' : 'text'} min={key === 'cantidad_contada' ? 1 : undefined} value={String(payload[key] ?? '')} disabled={(key === 'partida' && master?.control_type === 'SERIAL') || (key === 'serie' && master?.control_type === 'PARTIDA') || (key === 'cantidad_contada' && master?.control_type === 'SERIAL')} onChange={(event) => update(key, event.target.value)} /></label>)}
        <label className="field"><span>DESCRIPCIÓN · SOLO LECTURA</span><input readOnly value={text(effective.descripcion ?? master?.descripcion)} /></label>
        <label className="field"><span>MOTIVO OBLIGATORIO</span><textarea value={reason} onChange={(event) => setReason(event.target.value)} maxLength={500} /></label>
        {master && <p className="cuts-note" role="status">Control de maestro: {master.control_type}. El servidor valida nuevamente estos datos.</p>}
        {errors.length > 0 && <ul className="form-error" role="alert">{errors.map((error) => <li key={error}>{error}</li>)}</ul>}
        {notice && <p className={notice.startsWith('RECTIFICACIÓN') ? 'form-success' : 'form-error'} role="status" aria-live="polite">{notice}</p>}
        <button className="button-primary rectification-save" type="button" disabled={saving} onClick={() => void save()}>{saving ? 'GUARDANDO RECTIFICACIÓN…' : 'GUARDAR RECTIFICACIÓN'}</button>
      </fieldset>
    </section>}
  </section>
}

function EvidenceCard({ title, values }: { title: string; values: EvidenceValues }) {
  return <article className="evidence-card"><h4>{title}</h4><dl>{[...physicalFields, 'descripcion' as const].map((key) => <div key={key}><dt>{labels[key]}</dt><dd>{text(values[key]) || '—'}</dd></div>)}</dl></article>
}

function History({ history }: { history: CutRectification[] }) {
  return <section className="rectification-history" aria-labelledby="history-title"><h4 id="history-title">HISTORIAL DE RECTIFICACIONES</h4>{history.length === 0 ? <p>Sin rectificaciones: el estado efectivo es la evidencia original del corte.</p> : <ol>{history.map((row) => <li key={row.id}><strong>R{String(row.rectification_number).padStart(3, '0')}</strong><span>{new Date(row.created_at).toLocaleString()} · Actor {row.created_by}</span><span>Motivo: {row.reason}</span><Comparison previous={row.old_values} corrected={row.new_values} /></li>)}</ol>}</section>
}

function Comparison({ previous, corrected }: { previous: EvidenceValues; corrected: EvidenceValues }) {
  return <dl className="rectification-comparison">{physicalFields.map((key) => <div key={key}><dt>{labels[key]}</dt><dd><span>Anterior: {text(previous[key]) || '—'}</span><span>Correcto: {text(corrected[key]) || '—'}</span></dd></div>)}</dl>
}
