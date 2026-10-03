import { useEffect, useMemo, useRef, useState } from 'react'
import { hasBlockingSystemReferenceIssues, type SystemReferencePreview } from '../../domain/reconciliation/system-reference-contracts'
import { SupabaseReconciliationRepository } from '../../services/supabase-reconciliation-repository'
import { parseSystemReferenceFiles } from './system-reference-import-parser'

const repo=new SupabaseReconciliationRepository()

export function SystemReferencePanel({inventoryId,inventoryStatus,onMaterialized}:{inventoryId:string;inventoryStatus:string;onMaterialized:()=>Promise<void>|void}){
 const [preview,setPreview]=useState<SystemReferencePreview|null>(null)
 const [message,setMessage]=useState('Carga el archivo de partidas y el archivo de series de Softland; INVEN3 los combina sin modificar stock.')
 const [busy,setBusy]=useState(false)
 const [batchFile,setBatchFile]=useState<File|null>(null)
 const [serialFile,setSerialFile]=useState<File|null>(null)
 const batchFileInputRef=useRef<HTMLInputElement>(null)
 const serialFileInputRef=useRef<HTMLInputElement>(null)
 useEffect(()=>{setPreview(null);setBatchFile(null);setSerialFile(null);setMessage('Carga el archivo de partidas y el archivo de series de Softland; INVEN3 los combina sin modificar stock.');if(batchFileInputRef.current)batchFileInputRef.current.value='';if(serialFileInputRef.current)serialFileInputRef.current.value=''},[inventoryId])
 const errors=useMemo(()=>preview?.issues.filter(issue=>issue.severity==='ERROR')??[],[preview])
 const warnings=useMemo(()=>preview?.issues.filter(issue=>issue.severity==='WARNING')??[],[preview])
 const canImport=(inventoryStatus==='BORRADOR'||inventoryStatus==='PREPARADO')&&!!preview&&preview.itemCount>0&&!hasBlockingSystemReferenceIssues(preview)

 async function handleFiles(nextBatchFile:File,nextSerialFile:File){
  try{
   setBusy(true)
   const next=await parseSystemReferenceFiles(nextBatchFile,nextSerialFile)
   setPreview(next)
   setMessage(hasBlockingSystemReferenceIssues(next)?'Preview bloqueado: corrige los errores del libro RP antes de importar.':'Preview válido: '+next.itemCount+' referencias listas para importación atómica.')
  }catch(error){
   setPreview(null)
   setMessage(error instanceof Error?error.message:'No fue posible leer la referencia de sistema.')
  }finally{setBusy(false)}
 }

 function selectBatchFile(file:File|undefined){
  const next=file??null
  setBatchFile(next)
  setPreview(null)
  if(next&&serialFile)void handleFiles(next,serialFile)
  else setMessage('Archivo de partidas seleccionado. Ahora selecciona el archivo de series de Softland.')
 }

 function selectSerialFile(file:File|undefined){
  const next=file??null
  setSerialFile(next)
  setPreview(null)
  if(batchFile&&next)void handleFiles(batchFile,next)
  else setMessage('Archivo de series seleccionado. Ahora selecciona el archivo de partidas de Softland.')
 }

 function changeFiles(){
  setPreview(null)
  setBatchFile(null)
  setSerialFile(null)
  setMessage('Archivos descartados. Selecciona nuevamente el archivo de partidas y el archivo de series.')
  if(batchFileInputRef.current)batchFileInputRef.current.value=''
  if(serialFileInputRef.current)serialFileInputRef.current.value=''
  batchFileInputRef.current?.click()
 }

 async function handleImport(){
  if(!preview||!canImport)return
  try{
   setBusy(true)
   const result=await repo.importSystemReference(inventoryId,preview.items,preview.fileName,preview.fileSha256,preview.sourceFiles)
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
  <p>Snapshot de evidencia para comparar sistema vs. físico. Carga los dos archivos de Softland: partidas y series. Nunca ejecuta ajustes de inventario.</p>
  {(inventoryStatus==='BORRADOR'||inventoryStatus==='PREPARADO')&&<>
   <label className="file-drop"><span>Archivo de partidas (.xlsx)</span><input ref={batchFileInputRef} type="file" accept=".xlsx,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet" disabled={busy} onChange={event=>selectBatchFile(event.target.files?.[0])}/>{batchFile&&<small>{batchFile.name}</small>}</label>
   <label className="file-drop"><span>Archivo de series (.xlsx)</span><input ref={serialFileInputRef} type="file" accept=".xlsx,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet" disabled={busy} onChange={event=>selectSerialFile(event.target.files?.[0])}/>{serialFile&&<small>{serialFile.name}</small>}</label>
   {preview&&<button className="button-secondary" type="button" disabled={busy} onClick={changeFiles}>Cambiar archivos</button>}
   {preview&&<div className="master-summary" aria-label="Resumen referencia sistema">
    <Summary label="Referencias" value={preview.itemCount}/><Summary label="Series" value={preview.serialItems}/><Summary label="Partidas" value={preview.batchItems}/><Summary label="Legacy" value={preview.legacyItems}/><Summary label="Errores" value={errors.length}/><Summary label="Warnings" value={warnings.length}/>
   </div>}
   {preview&&preview.issues.length>0&&<div className="master-errors"><h3>Validaciones RP</h3><ul>{preview.issues.slice(0,25).map((issue,index)=><li key={issue.sheet+'-'+issue.rowNumber+'-'+index}><strong>{issue.severity} · {issue.sheet}{issue.rowNumber?' · fila '+issue.rowNumber:''}</strong> · {issue.codigo||'—'}{issue.referenceValue?' · '+issue.referenceValue:''}<br/><span>{issue.message}</span></li>)}</ul>{preview.issues.length>25&&<p>Se muestran 25 de {preview.issues.length} observaciones.</p>}</div>}
   <button className="button-primary" type="button" disabled={!canImport||busy} onClick={()=>void handleImport()}>{busy?'Procesando…':'CONFIRMAR REFERENCIA DE SISTEMA'}</button>
  </>}
  {inventoryStatus==='ABIERTO'&&<button className="button-primary" type="button" disabled={busy} onClick={()=>void handleMaterialize()}>{busy?'Procesando…':'GENERAR / ACTUALIZAR HALLAZGOS'}</button>}
  <p className="master-message" role="status">{message}</p>
 </section>
}

function Summary({label,value}:{label:string;value:number}){return <div className="master-summary__item"><span>{label}</span><strong>{value}</strong></div>}
