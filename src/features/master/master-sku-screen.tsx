import { useMemo, useState } from 'react'
import { createMasterFingerprint, validMasterItems, type MasterImportPreview, type MasterMetadata } from '../../domain/master/contracts'
import { refreshMasterSnapshot } from '../../domain/master/offline-master'
import { getMasterSkuRepository } from '../counting/counting-runtime'
import { parseMasterClipboard, parseMasterFile } from './master-import-parser'
import { SupabaseMasterSkuRepository } from '../../services/supabase-master-sku-repository'

const remoteMasterRepository = new SupabaseMasterSkuRepository()

export function MasterSkuScreen() {
  const [inventoryId, setInventoryId] = useState('')
  const [preview, setPreview] = useState<MasterImportPreview | null>(null)
  const [metadata, setMetadata] = useState<MasterMetadata | null>(null)
  const [pasteText, setPasteText] = useState('')
  const [importBusy, setImportBusy] = useState(false)
  const [importSource, setImportSource] = useState<'FILE' | 'PASTE'>('FILE')
  const [exceptionCode, setExceptionCode] = useState('')
  const [exceptionDescription, setExceptionDescription] = useState('')
  const [exceptionReason, setExceptionReason] = useState('')
  const [exceptionBusy, setExceptionBusy] = useState(false)
  const [message, setMessage] = useState('Pega desde Excel/Sheets o selecciona un archivo CSV/XLSX para validar el maestro antes de importarlo.')
  const validItems = useMemo(() => preview ? validMasterItems(preview) : [], [preview])

  function applyPreview(nextPreview: MasterImportPreview, source: string) {
    setPreview(nextPreview)
    setMessage(
      nextPreview.rejectedRows
        ? `${source}: revisa las filas rechazadas; no se habilitará una importación parcial.`
        : `${source}: preview válido con ${nextPreview.validRows} SKU. Puedes confirmar la importación atómica.`,
    )
  }

  function handleClipboardText(text: string) {
    setPasteText(text)
    setImportSource('PASTE')
    if (!text.trim()) {
      setPreview(null)
      setMessage('Pega al menos las columnas Código y Descripción.')
      return
    }
    try {
      applyPreview(parseMasterClipboard(text), 'Pegado Excel')
    } catch (error: unknown) {
      setPreview(null)
      setMessage(describeError(error, 'No fue posible interpretar los datos pegados.'))
    }
  }

  async function handleFile(file: File | undefined) {
    if (!file) return
    try {
      const nextPreview = await parseMasterFile(file)
      setImportSource('FILE')
      applyPreview(nextPreview, file.name)
    } catch (error: unknown) {
      setPreview(null)
      setMessage(describeError(error, 'No fue posible leer el archivo.'))
    }
  }

  async function handleImport() {
    const targetInventoryId = inventoryId.trim()
    if (!targetInventoryId) { setMessage('Ingresa el UUID del inventario.'); return }
    if (!preview || preview.rejectedRows > 0 || validItems.length === 0) {
      setMessage('El preview debe estar completo y sin errores antes de confirmar.')
      return
    }

    setImportBusy(true)
    try {
      const fingerprint = await createMasterFingerprint(validItems)
      const nextMetadata = await remoteMasterRepository.importPreview(targetInventoryId, validItems, fingerprint, importSource)
      setMetadata(nextMetadata)

      try {
        await refreshMasterSnapshot(targetInventoryId, remoteMasterRepository, getMasterSkuRepository())
        setMessage(`Maestro importado: versión ${nextMetadata.masterVersion}, ${nextMetadata.rowCount} SKU. Copia offline actualizada y lista para conteo.`)
      } catch (cacheError: unknown) {
        setMessage(`Maestro importado en servidor: versión ${nextMetadata.masterVersion}, ${nextMetadata.rowCount} SKU. La copia offline no pudo refrescarse: ${describeError(cacheError, 'error local desconocido')}`)
      }
    } catch (error: unknown) {
      setMessage(describeError(error, 'La importación fue rechazada.'))
    } finally {
      setImportBusy(false)
    }
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
      const nextMetadata = await remoteMasterRepository.addException(targetInventoryId, codigo, descripcion, reason)
      setMetadata(nextMetadata)
      setExceptionCode('')
      setExceptionDescription('')
      setExceptionReason('')
      try {
        await refreshMasterSnapshot(targetInventoryId, remoteMasterRepository, getMasterSkuRepository())
        setMessage(`Excepción agregada con trazabilidad: versión ${nextMetadata.masterVersion}, ${nextMetadata.rowCount} SKU. Copia offline actualizada.`)
      } catch (cacheError: unknown) {
        setMessage(`Excepción agregada en servidor: versión ${nextMetadata.masterVersion}. La copia offline no pudo refrescarse: ${describeError(cacheError, 'error local desconocido')}`)
      }
    } catch (error: unknown) {
      setMessage(describeError(error, 'La excepción de maestro fue rechazada.'))
    } finally {
      setExceptionBusy(false)
    }
  }

  return <section className="master-screen" aria-labelledby="master-title">
    <header>
      <p className="eyebrow">Offline-first · maestro versionado</p>
      <h1 id="master-title">Maestro SKU</h1>
      <p className="master-screen__description">El servidor valida y versiona el snapshot; después INVEN3 refresca la copia local SQLite/IndexedDB para que el conteo no dependa de la red.</p>
    </header>

    <label className="field"><span>Inventario</span><input value={inventoryId} onChange={(event) => setInventoryId(event.target.value)} placeholder="UUID del inventario" inputMode="text" /></label>

    <section className="master-status" aria-labelledby="master-paste-title">
      <h2 id="master-paste-title">Pegar desde Excel</h2>
      <p>Copia Código + Descripción desde Excel o Google Sheets. También acepta encabezados <strong>Cod. Producto / Producto</strong>. Los duplicados se bloquean para evitar un snapshot ambiguo.</p>
      <label className="field">
        <span>Datos tabulados</span>
        <textarea
          value={pasteText}
          onChange={(event) => setPasteText(event.target.value)}
          onPaste={(event) => {
            const text = event.clipboardData.getData('text/plain')
            if (!text) return
            event.preventDefault()
            handleClipboardText(text)
          }}
          placeholder={'Cod. Producto\tProducto\n00001234\tProducto legacy\nNVI75200055P\tProducto partida'}
          rows={8}
          spellCheck={false}
        />
      </label>
      <button className="button-primary" type="button" disabled={!pasteText.trim() || importBusy} onClick={() => handleClipboardText(pasteText)}>
        Analizar pegado
      </button>
    </section>

    <label className="file-drop">
      <span>O cargar archivo maestro (.csv, .tsv, .txt o .xlsx)</span>
      <input
        type="file"
        accept=".csv,.tsv,.txt,.xlsx,text/csv,text/tab-separated-values,text/plain,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"
        disabled={importBusy}
        onChange={(event) => void handleFile(event.target.files?.[0])}
      />
    </label>

    <p className="master-message" role="status">{message}</p>

    {preview && <>
      <div className="master-summary" aria-label="Resumen de preview">
        <Summary label="Total filas" value={preview.totalRows} />
        <Summary label="Válidas" value={preview.validRows} tone="success" />
        <Summary label="Rechazadas" value={preview.rejectedRows} tone={preview.rejectedRows ? 'error' : undefined} />
        <Summary label="Duplicadas" value={preview.duplicateRows} />
        <Summary label="Vacías" value={preview.emptyRows} />
      </div>
      {preview.rejectedRows > 0 && <div className="master-errors">
        <h2>Filas rechazadas</h2>
        <ul>{preview.rows.filter((row) => row.errors.length > 0).map((row) => <li key={row.rowNumber}>
          <strong>Fila {row.rowNumber}</strong> · {row.codigo || '—'} · {row.descripcion || '—'}<br />
          <span>{row.errors.join(' · ')}</span>
        </li>)}</ul>
      </div>}
      <button className="button-primary" type="button" disabled={importBusy || preview.rejectedRows > 0 || validItems.length === 0} onClick={() => void handleImport()}>
        {importBusy ? 'Importando y preparando offline…' : 'Confirmar importación atómica'}
      </button>
    </>}

    <section className="master-status" aria-labelledby="master-exception-title">
      <h2 id="master-exception-title">Excepción de maestro</h2>
      <p>Uso controlado durante inventario ABIERTO. PostgreSQL limita esta acción a ANALISTA o ADMIN asignado y registra auditoría.</p>
      <label className="field"><span>Código SKU</span><input value={exceptionCode} onChange={(event) => setExceptionCode(event.target.value)} placeholder="Código faltante" autoCapitalize="characters" /></label>
      <label className="field"><span>Descripción</span><input value={exceptionDescription} onChange={(event) => setExceptionDescription(event.target.value)} placeholder="Descripción del producto" /></label>
      <label className="field"><span>Motivo obligatorio</span><textarea value={exceptionReason} onChange={(event) => setExceptionReason(event.target.value)} placeholder="Indica por qué el SKU no estaba incluido en el maestro original." /></label>
      <button className="button-primary" type="button" disabled={exceptionBusy || importBusy} onClick={() => void handleAddException()}>{exceptionBusy ? 'Registrando…' : 'Agregar excepción trazable'}</button>
    </section>

    {metadata && <section className="master-status" aria-label="Estado del maestro">
      <h2>Estado maestro</h2>
      <dl>
        <div><dt>Versión</dt><dd>{metadata.masterVersion}</dd></div>
        <div><dt>SKU</dt><dd>{metadata.rowCount}</dd></div>
        <div><dt>Fingerprint</dt><dd>{metadata.fingerprint}</dd></div>
      </dl>
    </section>}
  </section>
}

function Summary({ label, value, tone }: { label: string; value: number; tone?: 'success' | 'error' }) {
  return <div className={`master-summary__item${tone ? ` master-summary__item--${tone}` : ''}`}><span>{label}</span><strong>{value}</strong></div>
}

function describeError(error: unknown, fallback: string): string {
  if (error instanceof Error && error.message) return error.message
  if (!error || typeof error !== 'object') return fallback

  const candidate = error as { message?: unknown; details?: unknown; hint?: unknown; code?: unknown }
  const parts = [
    typeof candidate.message === 'string' ? candidate.message : '',
    typeof candidate.details === 'string' ? candidate.details : '',
    typeof candidate.hint === 'string' ? candidate.hint : '',
    typeof candidate.code === 'string' ? `código ${candidate.code}` : '',
  ].filter(Boolean)
  return parts.length ? parts.join(' · ') : fallback
}
