import { useEffect, useMemo, useRef, useState } from 'react'
import { createMasterFingerprint, validMasterItems, type MasterImportPreview, type MasterMetadata } from '../../domain/master/contracts'
import { hasBlockingSystemReferenceIssues, isBlockingSystemReferenceIssue, type SystemReferencePreview } from '../../domain/reconciliation/system-reference-contracts'
import { refreshMasterSnapshot } from '../../domain/master/offline-master'
import type { AppRole } from '../../domain/auth/contracts'
import { SupabaseMasterSkuRepository } from '../../services/supabase-master-sku-repository'
import { SupabaseReconciliationRepository, type ReconciliationSummary } from '../../services/supabase-reconciliation-repository'
import { SupabaseSupervisionRepository } from '../../services/supabase-supervision-repository'
import { getMasterSkuRepository } from '../counting/counting-runtime'
import { parseMasterClipboard, parseMasterFile } from '../master/master-import-parser'
import { parseSystemReferenceFiles } from '../reconciliation/system-reference-import-parser'

type Inventory = { id: string; name: string; status: string }
type BusyState = 'BOOT' | 'MASTER_PARSE' | 'MASTER_IMPORT' | 'RP_PARSE' | 'RP_IMPORT' | null

const supervision = new SupabaseSupervisionRepository()
const masters = new SupabaseMasterSkuRepository()
const reconciliation = new SupabaseReconciliationRepository()

export function DataLoadScreen({ role }: { role: AppRole | null }) {
  const [inventories, setInventories] = useState<Inventory[]>([])
  const [inventoryId, setInventoryId] = useState('')
  const [busy, setBusy] = useState<BusyState>('BOOT')
  const [message, setMessage] = useState('Selecciona un inventario para preparar su información.')

  const [masterPreview, setMasterPreview] = useState<MasterImportPreview | null>(null)
  const [masterMetadata, setMasterMetadata] = useState<MasterMetadata | null>(null)
  const [masterCodes, setMasterCodes] = useState<Set<string>>(new Set())
  const [masterPaste, setMasterPaste] = useState('')
  const [masterSource, setMasterSource] = useState<'FILE' | 'PASTE'>('FILE')
  const masterFileRef = useRef<HTMLInputElement>(null)

  const [batchFile, setBatchFile] = useState<File | null>(null)
  const [serialFile, setSerialFile] = useState<File | null>(null)
  const [rpPreview, setRpPreview] = useState<SystemReferencePreview | null>(null)
  const [referenceSummary, setReferenceSummary] = useState<ReconciliationSummary['source_reference']>(null)
  const [authorizedBatchCodes, setAuthorizedBatchCodes] = useState<Set<string>>(new Set())
  const batchFileRef = useRef<HTMLInputElement>(null)
  const serialFileRef = useRef<HTMLInputElement>(null)

  const selectedInventory = useMemo(() => inventories.find((item) => item.id === inventoryId) ?? null, [inventories, inventoryId])
  const preparationOpen = selectedInventory?.status === 'BORRADOR' || selectedInventory?.status === 'PREPARADO'
  const validMasterRows = useMemo(() => masterPreview ? validMasterItems(masterPreview) : [], [masterPreview])
  const masterErrors = masterPreview?.rejectedRows ?? 0
  const rpBlockers = useMemo(() => rpPreview?.issues.filter(isBlockingSystemReferenceIssue) ?? [], [rpPreview])
  const rpFindings = useMemo(() => rpPreview?.issues.filter((issue) => !isBlockingSystemReferenceIssue(issue)) ?? [], [rpPreview])
  const pendingBatchCodes = useMemo(
    () => rpPreview?.unidentifiedBatchCodes.filter((codigo) => !authorizedBatchCodes.has(codigo)) ?? [],
    [rpPreview, authorizedBatchCodes],
  )
  const masterReady = Boolean(masterMetadata && masterCodes.size > 0)
  const rpReady = Boolean(referenceSummary)
  const canImportMaster = role === 'ADMIN' && preparationOpen && !!masterPreview && masterErrors === 0 && validMasterRows.length > 0 && busy === null
  const canImportRp = preparationOpen && masterReady && !!rpPreview && rpPreview.itemCount > 0 && !hasBlockingSystemReferenceIssues(rpPreview) && (pendingBatchCodes.length === 0 || role === 'ADMIN') && busy === null

  useEffect(() => {
    let active = true
    setBusy('BOOT')
    void supervision.inventories()
      .then((rows) => {
        if (!active) return
        const next = rows as Inventory[]
        setInventories(next)
        setInventoryId((current) => current || next[0]?.id || '')
        if (!next.length) setMessage('No existen inventarios autorizados para este usuario.')
      })
      .catch((error: unknown) => { if (active) setMessage(describeError(error, 'No fue posible cargar los inventarios.')) })
      .finally(() => { if (active) setBusy(null) })
    return () => { active = false }
  }, [])

  useEffect(() => {
    if (!inventoryId) return
    let active = true
    setMasterPreview(null)
    setMasterPaste('')
    setMasterSource('FILE')
    setBatchFile(null)
    setSerialFile(null)
    setRpPreview(null)
    if (masterFileRef.current) masterFileRef.current.value = ''
    if (batchFileRef.current) batchFileRef.current.value = ''
    if (serialFileRef.current) serialFileRef.current.value = ''
    setBusy('BOOT')

    void Promise.all([
      masters.getMetadata(inventoryId),
      masters.listByInventory(inventoryId),
      reconciliation.missingBatchExceptions(inventoryId),
      reconciliation.summary(inventoryId),
    ]).then(([metadata, items, exceptions, summary]) => {
      if (!active) return
      setMasterMetadata(metadata)
      setMasterCodes(new Set(items.map((item) => item.codigo)))
      setAuthorizedBatchCodes(new Set(exceptions.map((item) => item.codigo)))
      setReferenceSummary(summary.source_reference)
      setMessage(metadata
        ? `Inventario cargado. Maestro v${metadata.masterVersion} con ${metadata.rowCount} SKU.`
        : 'Inventario cargado. Comienza por el Maestro SKU.')
    }).catch((error: unknown) => {
      if (active) setMessage(describeError(error, 'No fue posible cargar el estado de preparación.'))
    }).finally(() => { if (active) setBusy(null) })

    return () => { active = false }
  }, [inventoryId])

  function applyMasterPreview(next: MasterImportPreview, source: 'FILE' | 'PASTE') {
    setMasterPreview(next)
    setMasterSource(source)
    setRpPreview(null)
    setBatchFile(null)
    setSerialFile(null)
    if (batchFileRef.current) batchFileRef.current.value = ''
    if (serialFileRef.current) serialFileRef.current.value = ''
    setMessage(next.rejectedRows
      ? `Maestro leído con ${next.rejectedRows} filas rechazadas. Corrige antes de confirmar.`
      : `Maestro validado: ${next.validRows} SKU únicos listos para confirmar.`)
  }

  async function handleMasterFile(file: File | undefined) {
    if (!file) return
    try {
      setBusy('MASTER_PARSE')
      applyMasterPreview(await parseMasterFile(file), 'FILE')
      setMasterPaste('')
    } catch (error: unknown) {
      setMasterPreview(null)
      setMessage(describeError(error, 'No fue posible leer el Maestro SKU.'))
    } finally { setBusy(null) }
  }

  function handleMasterPaste(text: string) {
    setMasterPaste(text)
    if (!text.trim()) { setMasterPreview(null); return }
    try { applyMasterPreview(parseMasterClipboard(text), 'PASTE') }
    catch (error: unknown) {
      setMasterPreview(null)
      setMessage(describeError(error, 'No fue posible interpretar el pegado de Excel.'))
    }
  }

  async function confirmMaster() {
    if (!canImportMaster || !masterPreview) return
    try {
      setBusy('MASTER_IMPORT')
      const fingerprint = await createMasterFingerprint(validMasterRows)
      if (masterMetadata && masterMetadata.rowCount === validMasterRows.length && masterMetadata.fingerprint.toLowerCase() === fingerprint.toLowerCase()) {
        await refreshMasterSnapshot(inventoryId, masters, getMasterSkuRepository())
        setMessage('El Maestro coincide exactamente con el snapshot activo. No se creó una nueva versión ni se invalidó la referencia RP; la copia offline quedó verificada.')
        return
      }
      const metadata = await masters.importPreview(inventoryId, validMasterRows, fingerprint, masterSource)
      await refreshMasterSnapshot(inventoryId, masters, getMasterSkuRepository())
      const items = await masters.listByInventory(inventoryId)
      setMasterMetadata(metadata)
      setMasterCodes(new Set(items.map((item) => item.codigo)))
      setReferenceSummary(null)
      setRpPreview(null)
      setBatchFile(null)
      setSerialFile(null)
      if (batchFileRef.current) batchFileRef.current.value = ''
      if (serialFileRef.current) serialFileRef.current.value = ''
      setMessage(`Maestro confirmado: v${metadata.masterVersion}, ${metadata.rowCount} SKU. Copia offline actualizada. Continúa con Partidas/Lotes y Series.`)
    } catch (error: unknown) {
      setMessage(describeError(error, 'El Maestro fue rechazado.'))
    } finally { setBusy(null) }
  }

  async function parseRp(files: { batch: File; serial: File }, authorizations = authorizedBatchCodes) {
    const next = await parseSystemReferenceFiles(files.batch, files.serial, authorizations, masterCodes)
    setRpPreview(next)
    const pending = next.unidentifiedBatchCodes.filter((codigo) => !authorizations.has(codigo))
    const blockers = next.issues.filter(isBlockingSystemReferenceIssue)
    if (blockers.length > 0) {
      setMessage(`No se puede leer correctamente la estructura de los archivos: ${blockers.length} bloqueos técnicos.`)
    } else if (pending.length) {
      setMessage(`Archivos utilizables. ${pending.length} SKU sin Partida/Talla serán autorizados automáticamente al confirmar; las demás diferencias de Softland se conservarán como hallazgos de origen.`)
    } else {
      setMessage(`Archivos utilizables: ${next.itemCount} referencias. Las diferencias de Softland no bloquean el inventario y quedarán registradas como hallazgos de origen.`)
    }
  }

  async function tryParseRp(nextBatchFile: File | null, nextSerialFile: File | null) {
    setRpPreview(null)
    if (!masterReady || !nextBatchFile || !nextSerialFile) {
      if (nextBatchFile || nextSerialFile) setMessage('Carga los dos archivos RP: Partidas/Lotes y Series.')
      return
    }
    try {
      setBusy('RP_PARSE')
      await parseRp({ batch: nextBatchFile, serial: nextSerialFile })
    } catch (error: unknown) {
      setRpPreview(null)
      setMessage(describeError(error, 'No fue posible leer los archivos de Partidas/Lotes y Series.'))
    } finally { setBusy(null) }
  }

  async function handleBatchFile(file: File | undefined) {
    const next = file ?? null
    setBatchFile(next)
    await tryParseRp(next, serialFile)
  }

  async function handleSerialFile(file: File | undefined) {
    const next = file ?? null
    setSerialFile(next)
    await tryParseRp(batchFile, next)
  }


  async function confirmRp() {
    if (!canImportRp || !rpPreview || !batchFile || !serialFile) return
    try {
      setBusy('RP_IMPORT')
      let effectivePreview = rpPreview

      if (pendingBatchCodes.length > 0) {
        if (role !== 'ADMIN') throw new Error('Solo ADMIN puede registrar automáticamente excepciones de Partida/Talla ausente.')
        await reconciliation.authorizeMissingBatchExceptions(
          inventoryId,
          pendingBatchCodes,
          'Softland informa stock positivo sin Partida/Talla. Se conserva como discrepancia de origen para ser resuelta mediante inventario físico.',
        )
        const nextAuthorized = new Set([...authorizedBatchCodes, ...pendingBatchCodes])
        setAuthorizedBatchCodes(nextAuthorized)
        effectivePreview = await parseSystemReferenceFiles(batchFile, serialFile, nextAuthorized, masterCodes)
        setRpPreview(effectivePreview)
      }

      const result = await reconciliation.importSystemReference(
        inventoryId,
        effectivePreview.items,
        effectivePreview.fileName,
        effectivePreview.fileSha256,
        effectivePreview.sourceFiles ?? [],
      )
      const summary = await reconciliation.summary(inventoryId)
      setReferenceSummary(summary.source_reference)
      setMessage(`Referencia Softland aceptada como evidencia: v${result.reference_version}, ${result.row_count} referencias. Las inconsistencias de origen no bloquearon el inventario.`)
    } catch (error: unknown) {
      setMessage(describeError(error, 'La referencia RP fue rechazada.'))
    } finally { setBusy(null) }
  }

  return <section className="data-load-screen" aria-labelledby="data-load-title">
    <header>
      <p className="eyebrow">Preparación centralizada</p>
      <h1 id="data-load-title">CENTRO DE CARGA</h1>
      <p>Un único módulo para cargar los tres archivos operativos: Maestro SKU, Partidas/Lotes y Series. Conciliación y Maestro ya no reciben archivos.</p>
    </header>

    <label className="field data-load-inventory">
      <span>Inventario</span>
      <select value={inventoryId} disabled={busy === 'BOOT'} onChange={(event) => setInventoryId(event.target.value)}>
        {inventories.map((inventory) => <option key={inventory.id} value={inventory.id}>{inventory.name} · {inventory.status}</option>)}
      </select>
    </label>

    {selectedInventory && <div className="data-load-progress" aria-label="Progreso de carga">
      <ProgressStep number="1" label="Maestro SKU" state={masterReady ? 'READY' : 'PENDING'} />
      <ProgressStep number="2" label="Referencia RP" state={rpReady ? 'READY' : masterReady ? 'ACTIVE' : 'LOCKED'} />
      <ProgressStep number="3" label="Preparado" state={masterReady && rpReady ? 'READY' : 'LOCKED'} />
    </div>}

    {!preparationOpen && selectedInventory && <p className="form-warning">El inventario está {selectedInventory.status}. La carga sólo se permite en BORRADOR o PREPARADO; los datos existentes quedan en modo consulta.</p>}

    <section className="data-load-card" aria-labelledby="load-master-title">
      <header><span className="data-load-card__number">1</span><div><h2 id="load-master-title">Maestro SKU</h2><p>Define los SKU habilitados para conteo. Carga archivo o pega dos columnas desde Excel; ambos caminos llegan al mismo preview.</p></div></header>

      {masterMetadata && <div className="data-load-current"><strong>Actual</strong><span>v{masterMetadata.masterVersion} · {masterMetadata.rowCount} SKU · {masterMetadata.fingerprint.slice(0, 12)}…</span></div>}

      {preparationOpen && <>
        <div className="data-load-source-grid">
          <label className="file-drop"><span>Archivo Maestro (.xlsx, .csv, .tsv, .txt)</span><input ref={masterFileRef} type="file" accept=".xlsx,.csv,.tsv,.txt,text/csv,text/tab-separated-values,text/plain,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet" disabled={busy !== null} onChange={(event) => void handleMasterFile(event.target.files?.[0])}/></label>
          <label className="field"><span>O pegar desde Excel / Sheets</span><textarea rows={7} value={masterPaste} disabled={busy !== null} onChange={(event) => handleMasterPaste(event.target.value)} placeholder={'Cod. Producto\tProducto\n00001234\tProducto legacy'}/></label>
        </div>

        {masterPreview && <>
          <div className="master-summary" aria-label="Resumen Maestro SKU">
            <Summary label="Filas" value={masterPreview.totalRows}/><Summary label="SKU únicos" value={masterPreview.validRows}/><Summary label="Rechazadas" value={masterPreview.rejectedRows}/><Summary label="Consolidadas" value={masterPreview.duplicateRows}/>
          </div>
          {masterPreview.rejectedRows > 0 && <IssueList title="Filas rechazadas" items={masterPreview.rows.filter((row) => row.errors.length).slice(0, 25).map((row) => ({key:String(row.rowNumber),title:`Fila ${row.rowNumber} · ${row.codigo || '—'}`,detail:row.errors.join(' · ')}))}/>}
          {role === 'ADMIN'
            ? <button className="button-primary" type="button" disabled={!canImportMaster} onClick={() => void confirmMaster()}>{busy === 'MASTER_IMPORT' ? 'CONFIRMANDO MAESTRO…' : masterMetadata ? 'REEMPLAZAR MAESTRO' : 'CONFIRMAR MAESTRO'}</button>
            : <p className="form-warning">Solo ADMIN puede confirmar o reemplazar el Maestro. ANALISTA puede revisar el preview.</p>}
        </>}
      </>}
    </section>

    <section className={`data-load-card ${masterReady ? '' : 'data-load-card--locked'}`} aria-labelledby="load-rp-title">
      <header><span className="data-load-card__number">2</span><div><h2 id="load-rp-title">Partidas/Lotes + Series</h2><p>Estos son dos archivos distintos de Softland. Partidas/Lotes contiene la columna Partida / Talla y Series contiene la columna Serie. Se cruzan contra el Maestro confirmado.</p></div></header>

      {referenceSummary && <div className="data-load-current"><strong>Actual</strong><span>v{referenceSummary.reference_version} · {referenceSummary.row_count} referencias · {referenceSummary.fingerprint.slice(0, 12)}…</span></div>}

      {!masterReady && <p className="data-load-lock-note">Primero confirma el archivo Maestro SKU con todos los códigos.</p>}
      {preparationOpen && masterReady && <>
        <div className="data-load-source-grid">
          <label className="file-drop"><span>Archivo Partidas / Lotes (.xlsx)</span><input ref={batchFileRef} type="file" accept=".xlsx,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet" disabled={busy !== null} onChange={(event) => void handleBatchFile(event.target.files?.[0])}/>{batchFile && <small>{batchFile.name}</small>}</label>
          <label className="file-drop"><span>Archivo Series (.xlsx)</span><input ref={serialFileRef} type="file" accept=".xlsx,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet" disabled={busy !== null} onChange={(event) => void handleSerialFile(event.target.files?.[0])}/>{serialFile && <small>{serialFile.name}</small>}</label>
        </div>

        {rpPreview && <>
          <div className="master-summary" aria-label="Resumen referencia RP">
            <Summary label="Referencias" value={rpPreview.itemCount}/><Summary label="Series" value={rpPreview.serialItems}/><Summary label="Partidas" value={rpPreview.batchItems}/><Summary label="Legacy" value={rpPreview.legacyItems}/><Summary label="Bloqueos técnicos" value={rpBlockers.length}/><Summary label="Hallazgos Softland" value={rpFindings.length}/>
          </div>

          {rpPreview.issues.length > 0 && <IssueList title="Hallazgos de origen Softland" items={rpPreview.issues.slice(0, 25).map((issue, index) => ({
            key:`${issue.sheet}-${issue.rowNumber}-${index}`,
            title:`${issue.severity} · ${issue.sheet}${issue.rowNumber ? ` · fila ${issue.rowNumber}` : ''} · ${issue.codigo || '—'}`,
            detail:`${issue.referenceValue ? `${issue.referenceValue} · ` : ''}${issue.message}`,
          }))}/>}

          {pendingBatchCodes.length > 0 && <div className="data-load-exception">
            <h3>Discrepancias de Partida/Talla detectadas</h3>
            <p>{pendingBatchCodes.length} SKU vienen desde Softland con stock positivo pero sin Partida/Talla. No bloquean la carga. Al confirmar, ADMIN registrará automáticamente la excepción auditada y el inventario físico determinará la situación real.</p>
            <div className="data-load-code-list">{pendingBatchCodes.map((codigo) => <code key={codigo}>{codigo}</code>)}</div>
          </div>}

          <button className="button-primary" type="button" disabled={!canImportRp} onClick={() => void confirmRp()}>{busy === 'RP_IMPORT' ? 'CONFIRMANDO RP…' : referenceSummary ? 'REEMPLAZAR REFERENCIA RP' : 'CONFIRMAR REFERENCIA RP'}</button>
        </>}
      </>}
    </section>

    <section className={`data-load-card data-load-card--summary ${masterReady && rpReady ? '' : 'data-load-card--locked'}`}>
      <header><span className="data-load-card__number">3</span><div><h2>Preparación</h2><p>Cuando ambos snapshots están confirmados, el inventario queda listo para continuar su flujo operativo.</p></div></header>
      <div className="data-load-readiness">
        <span>{masterReady ? '✓' : '—'} Maestro {masterReady ? 'confirmado' : 'pendiente'}</span>
        <span>{rpReady ? '✓' : '—'} Partidas/Lotes + Series {rpReady ? 'confirmadas' : 'pendientes'}</span>
        <strong>{masterReady && rpReady ? 'DATOS PREPARADOS' : 'PREPARACIÓN INCOMPLETA'}</strong>
      </div>
    </section>

    <p className="master-message data-load-message" role="status">{busy && busy !== 'BOOT' ? 'Procesando… ' : ''}{message}</p>
  </section>
}

function Summary({label,value}:{label:string;value:number}) {
  return <div className="master-summary__item"><span>{label}</span><strong>{value}</strong></div>
}

function ProgressStep({number,label,state}:{number:string;label:string;state:'READY'|'ACTIVE'|'PENDING'|'LOCKED'}) {
  return <div className={`data-load-progress__step data-load-progress__step--${state.toLowerCase()}`}><span>{number}</span><strong>{label}</strong><small>{state === 'READY' ? 'Listo' : state === 'ACTIVE' ? 'Siguiente' : state === 'PENDING' ? 'Pendiente' : 'Bloqueado'}</small></div>
}

function IssueList({title,items}:{title:string;items:Array<{key:string;title:string;detail:string}>}) {
  return <div className="master-errors"><h3>{title}</h3><ul>{items.map((item) => <li key={item.key}><strong>{item.title}</strong><br/><span>{item.detail}</span></li>)}</ul></div>
}

function describeError(error: unknown, fallback: string): string {
  if (error instanceof Error && error.message) return error.message
  if (!error || typeof error !== 'object') return fallback
  const candidate = error as { message?: unknown; details?: unknown; hint?: unknown; code?: unknown }
  return [
    typeof candidate.message === 'string' ? candidate.message : '',
    typeof candidate.details === 'string' ? candidate.details : '',
    typeof candidate.hint === 'string' ? candidate.hint : '',
    typeof candidate.code === 'string' ? `código ${candidate.code}` : '',
  ].filter(Boolean).join(' · ') || fallback
}
