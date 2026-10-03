import { useEffect, useMemo, useState } from 'react'
import { hasBlockingSystemReferenceIssues, type SystemReferencePreview } from '../../domain/reconciliation/system-reference-contracts'
import { SupabaseReconciliationRepository } from '../../services/supabase-reconciliation-repository'
import { parseSystemReferenceFile } from './system-reference-import-parser'

const repo=new SupabaseReconciliationRepository()

export function SystemReferencePanel({inventoryId,inventoryStatus,role,onMaterialized}:{inventoryId:string;inventoryStatus:string;role:'CONTADOR'|'ANALISTA'|'ADMIN'|null;onMaterialized:()=>Promise<void>|void}){
 const [preview,setPreview]=useState<SystemReferencePreview|null>(null)
 const [message,setMessage]=useState('La referencia de sistema proviene del libro RP completo; no modifica stock.')
 const [busy,setBusy]=useState(false)
 const [sourceFile,setSourceFile]=useState<File|null>(null)
 const [authorizedBatchCodes,setAuthorizedBatchCodes]=useState<Set<string>>(new Set())
 const [exceptionReason,setExceptionReason]=useState('')
 useEffect(()=>{
  setPreview(null);setSourceFile(null);setExceptionReason('')
  setMessage('La referencia de sistema proviene del libro RP completo; no modifica stock.')
  void repo.missingBatchExceptions(inventoryId)
   .then(rows=>setAuthorizedBatchCodes(new Set(rows.map(row=>row.codigo))))
   .catch(()=>setAuthorizedBatchCodes(new Set()))
 },[inventoryId])
 const errors=useMemo(()=>preview?.issues.filter(issue=>issue.severity==='ERROR')??[],[preview])
 const warnings=useMemo(()=>preview?.issues.filter(issue=>issue.severity==='WARNING')??[],[preview])
 const pendingBatchCodes=useMemo(()=>preview?.unidentifiedBatchCodes.filter(codigo=>!authorizedBatchCodes.has(codigo))??[],[preview,authorizedBatchCodes])
 const canImport=(inventoryStatus==='BORRADOR'||inventoryStatus==='PREPARADO')&&!!preview&&preview.itemCount>0&&!hasBlockingSystemReferenceIssues(preview)&&pendingBatchCodes.length===0

 async function parseFile(file:File,authorizedCodes:ReadonlySet<string>){
  const next=await parseSystemReferenceFile(file,authorizedCodes)
  setPreview(next)
  const pending=next.unidentifiedBatchCodes.filter(codigo=>!authorizedCodes.has(codigo))
  if(hasBlockingSystemReferenceIssues(next)) setMessage('Preview bloqueado: corrige los errores del libro RP antes de importar.')
  else if(pending.length>0) setMessage(`Preview válido, pero ${pending.length} SKU con stock positivo sin Partida/Talla requieren autorización controlada antes de confirmar.`)
  else setMessage('Preview válido: '+next.itemCount+' referencias listas para importación atómica.')
 }

 async function handleFile(file:File|undefined){
  if(!file)return
  try{
   setBusy(true);setSourceFile(file)
   await parseFile(file,authorizedBatchCodes)
  }catch(error){
   setPreview(null)
   setMessage(error instanceof Error?error.message:'No fue posible leer la referencia de sistema.')
  }finally{setBusy(false)}
 }

 async function authorizePending(){
  if(!sourceFile||role!=='ADMIN'||pendingBatchCodes.length===0||exceptionReason.trim().length<10)return
  try{
   setBusy(true)
   await repo.authorizeMissingBatchExceptions(inventoryId,pendingBatchCodes,exceptionReason.trim())
   const nextAuthorized=new Set([...authorizedBatchCodes,...pendingBatchCodes])
   setAuthorizedBatchCodes(nextAuthorized)
   setExceptionReason('')
   await parseFile(sourceFile,nextAuthorized)
   setMessage(`Excepción controlada autorizada para ${pendingBatchCodes.length} SKU. Se usa referencia técnica EXC-SIN-PARTIDA:SKU; no se inventa una partida real.`)
  }catch(error){
   setMessage(error instanceof Error?error.message:'No fue posible autorizar las excepciones controladas.')
  }finally{setBusy(false)}
 }

 async function handleImport(){
  if(!preview||!canImport)return
  try{
   setBusy(true)
   const result=await repo.importSystemReference(inventoryId,preview.items,preview.fileName,preview.fileSha256)
   setMessage('Referencia importada: versión '+result.reference_version+', '+result.row_count+' filas, fingerprint '+result.fingerprint.slice(0,12)+'…')
  }catch(error){
   setMessage(error instanceof Error?error.message:'La referencia de sistema fue rechazada.')
  }finally{setBusy(false)}
 }

 async function handleMaterialize(){
  try{
   setBusy(true)
   const result=await repo.materialize(inventoryId)
   setMessage('Conciliación actualizada: '+result.created_count+' casos nuevos, '+result.existing_count+' casos abiertos para este snapshot.')
   await onMaterialized()
  }catch(error){
   setMessage(error instanceof Error?error.message:'No fue posible materializar la conciliación.')
  }finally{setBusy(false)}
 }

 return <section className="master-status" aria-labelledby="system-reference-title">
  <h2 id="system-reference-title">Referencia de sistema RP</h2>
  <p>Snapshot de evidencia para comparar sistema vs. físico. Nunca ejecuta ajustes de inventario.</p>
  {(inventoryStatus==='BORRADOR'||inventoryStatus==='PREPARADO')&&<>
   <label className="file-drop"><span>Libro RP (.xlsx)</span><input type="file" accept=".xlsx,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet" disabled={busy} onChange={event=>void handleFile(event.target.files?.[0])}/></label>
   {preview&&<div className="master-summary" aria-label="Resumen referencia sistema">
    <Summary label="Referencias" value={preview.itemCount}/><Summary label="Series" value={preview.serialItems}/><Summary label="Partidas" value={preview.batchItems}/><Summary label="Legacy" value={preview.legacyItems}/><Summary label="Errores" value={errors.length}/><Summary label="Warnings" value={warnings.length}/>
   </div>}
   {preview&&preview.issues.length>0&&<div className="master-errors"><h3>Validaciones RP</h3><ul>{preview.issues.slice(0,25).map((issue,index)=><li key={issue.sheet+'-'+issue.rowNumber+'-'+index}><strong>{issue.severity} · {issue.sheet}{issue.rowNumber?' · fila '+issue.rowNumber:''}</strong> · {issue.codigo||'—'}{issue.referenceValue?' · '+issue.referenceValue:''}<br/><span>{issue.message}</span></li>)}</ul>{preview.issues.length>25&&<p>Se muestran 25 de {preview.issues.length} observaciones.</p>}</div>}
   {pendingBatchCodes.length>0&&<div className="master-errors">
    <h3>Autorización controlada pendiente</h3>
    <p>{pendingBatchCodes.length} SKU tienen stock positivo en Softland pero no traen Partida/Talla. No se inventará un lote. INVEN3 requiere autorización auditada y utilizará una referencia técnica temporal.</p>
    <p><strong>SKU:</strong> {pendingBatchCodes.join(', ')}</p>
    {role==='ADMIN'?<>
     <label className="field"><span>Motivo (mínimo 10 caracteres)</span><textarea value={exceptionReason} onChange={event=>setExceptionReason(event.target.value)} placeholder="Ej.: Softland informa stock positivo sin partida/talla en el snapshot RP." /></label>
     <button className="button-secondary" type="button" disabled={busy||exceptionReason.trim().length<10} onClick={()=>void authorizePending()}>AUTORIZAR EXCEPCIONES CONTROLADAS</button>
    </>:<p>Solo ADMIN puede autorizar estas excepciones.</p>}
   </div>}
   <button className="button-primary" type="button" disabled={!canImport||busy} onClick={()=>void handleImport()}>{busy?'Procesando…':'CONFIRMAR REFERENCIA DE SISTEMA'}</button>
  </>}
  {inventoryStatus==='ABIERTO'&&<button className="button-primary" type="button" disabled={busy} onClick={()=>void handleMaterialize()}>{busy?'Procesando…':'GENERAR / ACTUALIZAR HALLAZGOS'}</button>}
  <p className="master-message" role="status">{message}</p>
 </section>
}

function Summary({label,value}:{label:string;value:number}){return <div className="master-summary__item"><span>{label}</span><strong>{value}</strong></div>}
