import { useMemo, useRef, useState } from 'react'
import { createMasterFingerprint, validMasterItems, type MasterImportPreview, type MasterMetadata } from '../../domain/master/contracts'
import { parseMasterFile } from './master-import-parser'
import { SupabaseMasterSkuRepository } from '../../services/supabase-master-sku-repository'

export function MasterSkuScreen() {
  const [inventoryId, setInventoryId] = useState('')
  const [preview, setPreview] = useState<MasterImportPreview | null>(null)
  const [metadata, setMetadata] = useState<MasterMetadata | null>(null)
  const [exceptionCode, setExceptionCode] = useState('')
  const [exceptionDescription, setExceptionDescription] = useState('')
  const [exceptionReason, setExceptionReason] = useState('')
  const [exceptionBusy, setExceptionBusy] = useState(false)
  const [message, setMessage] = useState('Selecciona un archivo CSV o XLSX para validar el maestro antes de importarlo.')
  const fileInputRef = useRef<HTMLInputElement>(null)
  const validItems = useMemo(() => preview ? validMasterItems(preview) : [], [preview])

  async function handleFile(file: File | undefined) {
    if (!file) return
    try {
      const nextPreview = await parseMasterFile(file)
      setPreview(nextPreview)
      setMessage(nextPreview.rejectedRows ? 'Revisa las filas rechazadas: no se habilitará una importación parcial.' : 'Preview válido. Puedes confirmar la importación atómica.')
    } catch (error: unknown) { setMessage(error instanceof Error ? error.message : 'No fue posible leer el archivo.') }
  }

  function changeFile() {
    setPreview(null)
    setMessage('Archivo descartado. Selecciona el nuevo archivo maestro para generar otro preview.')
    if (fileInputRef.current) fileInputRef.current.value = ''
    fileInputRef.current?.click()
  }

  async function handleImport() {
    if (!inventoryId.trim()) { setMessage('Ingresa el UUID del inventario.'); return }
    if (!preview || preview.rejectedRows > 0 || validItems.length === 0) { setMessage('El preview debe estar completo y sin errores antes de confirmar.'); return }
    try {
      const fingerprint = await createMasterFingerprint(validItems)
      const nextMetadata = await new SupabaseMasterSkuRepository().importPreview(inventoryId.trim(), validItems, fingerprint)
      setMetadata(nextMetadata)
      setMessage(`Maestro importado atómicamente: versión ${nextMetadata.masterVersion}, ${nextMetadata.rowCount} SKU.`)
    } catch (error: unknown) { setMessage(error instanceof Error ? error.message : 'La importación fue rechazada.') }
  }

  async function handleAddException() {
    const targetInventoryId = inventoryId.trim()
    const codigo = exceptionCode.trim()
    const descripcion = exceptionDescription.trim()
    const reason = exceptionReason.trim()
    if (!targetInventoryId) { setMessage('Ingresa el UUID del inventario.'); return }
    if (!codigo || !descripcion || !reason) { setMessage('Código, descripción y motivo son obligatorios para una excepción de maestro.'); return }
    setExceptionBusy(true)
    try {
      const nextMetadata = await new SupabaseMasterSkuRepository().addException(targetInventoryId, codigo, descripcion, reason)
      setMetadata(nextMetadata)
      setExceptionCode('')
      setExceptionDescription('')
      setExceptionReason('')
      setMessage(`Excepción agregada con trazabilidad: versión ${nextMetadata.masterVersion}, ${nextMetadata.rowCount} SKU.`)
    } catch (error: unknown) {
      setMessage(error instanceof Error ? error.message : 'La excepción de maestro fue rechazada.')
    } finally {
      setExceptionBusy(false)
    }
  }

  return <section className="master-screen" aria-labelledby="master-title">
    <header><p className="eyebrow">Fase 2 · preparación offline</p><h1 id="master-title">Maestro SKU</h1><p className="master-screen__description">Carga y valida el snapshot antes de confirmarlo. La autorización final se aplica en PostgreSQL.</p></header>
    <label className="field"><span>Inventario</span><input value={inventoryId} onChange={(event) => setInventoryId(event.target.value)} placeholder="UUID del inventario" inputMode="text" /></label>
    <label className="file-drop"><span>Archivo maestro (.csv o .xlsx)</span><input ref={fileInputRef} type="file" accept=".csv,.xlsx,text/csv,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet" onChange={(event) => void handleFile(event.target.files?.[0])} /></label>
    <p className="master-message" role="status">{message}</p>
    {preview && <><button className="button-secondary" type="button" onClick={changeFile}>Cambiar archivo</button><div className="master-summary" aria-label="Resumen de preview">
      <Summary label="Total filas" value={preview.totalRows} /><Summary label="Válidas" value={preview.validRows} tone="success" /><Summary label="Rechazadas" value={preview.rejectedRows} tone={preview.rejectedRows ? 'error' : undefined} /><Summary label="Duplicadas" value={preview.duplicateRows} /><Summary label="Vacías" value={preview.emptyRows} />
    </div>
    {preview.rejectedRows > 0 && <div className="master-errors"><h2>Filas rechazadas</h2><ul>{preview.rows.filter((row) => row.errors.length > 0).map((row) => <li key={row.rowNumber}><strong>Fila {row.rowNumber}</strong> · {row.codigo || '—'} · {row.descripcion || '—'}<br /><span>{row.errors.join(' · ')}</span></li>)}</ul></div>}
    <button className="button-primary" type="button" disabled={preview.rejectedRows > 0 || validItems.length === 0} onClick={() => void handleImport()}>Confirmar importación atómica</button></>}
    <section className="master-status" aria-labelledby="master-exception-title">
      <h2 id="master-exception-title">Excepción de maestro</h2>
      <p>Uso controlado durante inventario ABIERTO. PostgreSQL limita esta acción a ANALISTA o ADMIN asignado y registra auditoría.</p>
      <label className="field"><span>Código SKU</span><input value={exceptionCode} onChange={(event) => setExceptionCode(event.target.value)} placeholder="Código faltante" autoCapitalize="characters" /></label>
      <label className="field"><span>Descripción</span><input value={exceptionDescription} onChange={(event) => setExceptionDescription(event.target.value)} placeholder="Descripción del producto" /></label>
      <label className="field"><span>Motivo obligatorio</span><textarea value={exceptionReason} onChange={(event) => setExceptionReason(event.target.value)} placeholder="Indica por qué el SKU no estaba incluido en el maestro original." /></label>
      <button className="button-primary" type="button" disabled={exceptionBusy} onClick={() => void handleAddException()}>{exceptionBusy ? 'Registrando…' : 'Agregar excepción trazable'}</button>
    </section>
    {metadata && <section className="master-status" aria-label="Estado del maestro"><h2>Estado maestro</h2><dl><div><dt>Versión</dt><dd>{metadata.masterVersion}</dd></div><div><dt>SKU</dt><dd>{metadata.rowCount}</dd></div><div><dt>Fingerprint</dt><dd>{metadata.fingerprint}</dd></div></dl></section>}
  </section>
}

function Summary({ label, value, tone }: { label: string; value: number; tone?: 'success' | 'error' }) {
  return <div className={`master-summary__item${tone ? ` master-summary__item--${tone}` : ''}`}><span>{label}</span><strong>{value}</strong></div>
}
