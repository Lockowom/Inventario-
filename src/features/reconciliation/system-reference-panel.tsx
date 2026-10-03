import { useEffect, useMemo, useRef, useState } from 'react'
import { createMasterFingerprint, validMasterItems, type MasterImportPreview } from '../../domain/master/contracts'
import { hasBlockingSystemReferenceIssues, type SystemReferencePreview } from '../../domain/reconciliation/system-reference-contracts'
import { SupabaseMasterSkuRepository } from '../../services/supabase-master-sku-repository'
import { SupabaseReconciliationRepository } from '../../services/supabase-reconciliation-repository'
import { parseMasterFile } from '../master/master-import-parser'
import { parseSystemReferenceFiles } from './system-reference-import-parser'

const repo=new SupabaseReconciliationRepository()
const masters=new SupabaseMasterSkuRepository()

export function SystemReferencePanel({inventoryId,inventoryStatus,role,onMaterialized}:{inventoryId:string;inventoryStatus:string;role:'CONTADOR'|'ANALISTA'|'ADMIN'|null;onMaterialized:()=>Promise<void>|void}){
 const [preview,setPreview]=useState<SystemReferencePreview|null>(null)
 const [message,setMessage]=useState('Carga el Maestro SKU, el archivo de partidas y el archivo de series. El Maestro define qué códigos se pueden contar; los otros dos sólo aportan referencia Softland.')
 const [busy,setBusy]=useState(false)
 const [batchFile,setBatchFile]=useState<File|null>(null)
 const [serialFile,setSerialFile]=useState<File|null>(null)
 const [masterFile,setMasterFile]=useState<File|null>(null)
 const [masterPreview,setMasterPreview]=useState<MasterImportPreview|null>(null)
 const [masterImported,setMasterImported]=useState(false)
 const [authorizedBatchCodes,setAuthorizedBatchCodes]=useState<Set<string>>(new Set())
 const [exceptionReason,setExceptionReason]=useState('')
 const batchFileInputRef=useRef<HTMLInputElement>(null)
 const serialFileInputRef=useRef<HTMLInputElement>(null)
 const masterFileInputRef=useRef<HTMLInputElement>(null)
 const masterCodes=useMemo(()=>new Set(masterPreview?validMasterItems(masterPreview).map(item=>item.codigo):[]),[masterPreview])
 useEffect(()=>{setPreview(null);setBatchFile(null);setSerialFile(null);setMasterFile(null);setMasterPreview(null);setMasterImported(false);setAuthorizedBatchCodes(new Set());setExceptionReason('');setMessage('Carga el Maestro SKU, el archivo de partidas y el archivo de series. El Maestro define qué códigos se pueden contar; los otros dos sólo aportan referencia Softland.');if(batchFileInputRef.current)batchFileInputRef.current.value='';if(serialFileInputRef.current)serialFileInputRef.current.value='';if(masterFileInputRef.current)masterFileInputRef.current.value='';const loadExceptions=repo.missingBatchExceptions;if(loadExceptions)void loadExceptions.call(repo,inventoryId).then(rows=>setAuthorizedBatchCodes(new Set(rows.map(row=>row.codigo)))).catch(()=>undefined)},[inventoryId])
 const errors=useMemo(()=>preview?.issues.filter(issue=>issue.severity==='ERROR')??[],[preview])
 const warnings=useMemo(()=>preview?.issues.filter(issue=>issue.severity==='WARNING')??[],[preview])
 const canImport=(inventoryStatus==='BORRADOR'||inventoryStatus==='PREPARADO')&&masterImported&&!!preview&&preview.itemCount>0&&!hasBlockingSystemReferenceIssues(preview)

 async function handleFiles(nextBatchFile:File,nextSerialFile:File){
  try{
   setBusy(true)
   const next=await parseSystemReferenceFiles(nextBatchFile,nextSerialFile,authorizedBatchCodes,masterCodes)
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

 async function selectMasterFile(file:File|undefined){
  const next=file??null
  setMasterFile(next);setMasterPreview(null);setMasterImported(false);setPreview(null)
  if(!next){setMessage('Selecciona el archivo Maestro SKU para continuar.');return}
  try{
   setBusy(true)
   const nextPreview=await parseMasterFile(next)
   setMasterPreview(nextPreview)
   setMessage(nextPreview.rejectedRows>0?'El Maestro tiene filas inválidas: corrígelas antes de confirmar.':`Maestro validado: ${nextPreview.validRows} SKU existentes. Confírmalo para habilitar el conteo de esos códigos.`)
   if(batchFile&&serialFile)await handleFiles(batchFile,serialFile)
  }catch(error){setMessage(error instanceof Error?error.message:'No fue posible leer el Maestro SKU.')
  }finally{setBusy(false)}
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
  setBatchFile(null);setSerialFile(null);setMasterFile(null);setMasterPreview(null);setMasterImported(false)
  setMessage('Archivos descartados. Selecciona nuevamente Maestro SKU, Partidas y Series.')
  if(batchFileInputRef.current)batchFileInputRef.current.value=''
  if(serialFileInputRef.current)serialFileInputRef.current.value=''
  if(masterFileInputRef.current)masterFileInputRef.current.value=''
  masterFileInputRef.current?.click()
 }

 async function importMaster(){
  if(!masterFile||!masterPreview||masterPreview.rejectedRows>0||role!=='ADMIN')return
  const items=validMasterItems(masterPreview)
  if(!items.length){setMessage('El Maestro no contiene SKU válidos.');return}
  try{
   setBusy(true)
   await masters.importPreview(inventoryId,items,await createMasterFingerprint(items))
   setMasterImported(true)
   if(batchFile&&serialFile)await handleFiles(batchFile,serialFile)
   else setMessage(`Maestro confirmado: ${items.length} SKU existentes habilitados para conteo. Ahora carga Partidas y Series.`)
  }catch(error){setMessage(error instanceof Error?error.message:'No fue posible confirmar el Maestro SKU.')
  }finally{setBusy(false)}
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

 async function authorizeMissingBatchExceptions(){
  if(!preview||!batchFile||!serialFile||role!=='ADMIN')return
  const pending=preview.unidentifiedBatchCodes.filter(codigo=>!authorizedBatchCodes.has(codigo))
  if(!pending.length||exceptionReason.trim().length<10)return
  try{
   setBusy(true)
   await repo.authorizeMissingBatchExceptions(inventoryId,pending,exceptionReason)
   const nextAuthorized=new Set([...authorizedBatchCodes,...pending])
   setAuthorizedBatchCodes(nextAuthorized)
   const next=await parseSystemReferenceFiles(batchFile,serialFile,nextAuthorized,masterCodes)
   setPreview(next)
   setMessage(`Excepción controlada autorizada para ${pending.length} SKU. Se conserva como referencia explícita, no como partida real.`)
  }catch(error){
   setMessage(error instanceof Error?error.message:'No fue posible autorizar la excepción controlada.')
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
  <p>El Maestro contiene todos los SKU existentes y habilita su conteo. Partidas y Series son snapshots de Softland para comparar el físico; nunca ejecutan ajustes de inventario.</p>
  {(inventoryStatus==='BORRADOR'||inventoryStatus==='PREPARADO')&&<>
   <label className="file-drop"><span>1. Maestro SKU (.csv o .xlsx)</span><input ref={masterFileInputRef} type="file" accept=".csv,.xlsx,text/csv,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet" disabled={busy} onChange={event=>void selectMasterFile(event.target.files?.[0])}/>{masterFile&&<small>{masterFile.name}</small>}</label>
   {masterPreview&&<div className="master-summary" aria-label="Resumen Maestro SKU"><Summary label="SKU existentes" value={masterPreview.validRows}/><Summary label="Filas inválidas" value={masterPreview.rejectedRows}/><Summary label="Duplicados consolidados" value={masterPreview.duplicateRows}/></div>}
   {masterPreview&&role==='ADMIN'&&<button className="button-secondary" type="button" disabled={busy||masterPreview.rejectedRows>0||masterImported} onClick={()=>void importMaster()}>{masterImported?'MAESTRO SKU CONFIRMADO':'CONFIRMAR MAESTRO SKU'}</button>}
   {masterPreview&&role!=='ADMIN'&&<p>Solo un ADMIN asignado puede confirmar el Maestro SKU.</p>}
   <label className="file-drop"><span>Archivo de partidas (.xlsx)</span><input ref={batchFileInputRef} type="file" accept=".xlsx,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet" disabled={busy} onChange={event=>selectBatchFile(event.target.files?.[0])}/>{batchFile&&<small>{batchFile.name}</small>}</label>
   <label className="file-drop"><span>Archivo de series (.xlsx)</span><input ref={serialFileInputRef} type="file" accept=".xlsx,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet" disabled={busy} onChange={event=>selectSerialFile(event.target.files?.[0])}/>{serialFile&&<small>{serialFile.name}</small>}</label>
   {preview&&<button className="button-secondary" type="button" disabled={busy} onClick={changeFiles}>Cambiar archivos</button>}
   {preview&&<div className="master-summary" aria-label="Resumen referencia sistema">
    <Summary label="Referencias" value={preview.itemCount}/><Summary label="Series" value={preview.serialItems}/><Summary label="Partidas" value={preview.batchItems}/><Summary label="Legacy" value={preview.legacyItems}/><Summary label="Errores" value={errors.length}/><Summary label="Warnings" value={warnings.length}/>
   </div>}
   {preview&&preview.issues.length>0&&<div className="master-errors"><h3>Validaciones RP</h3><ul>{preview.issues.slice(0,25).map((issue,index)=><li key={issue.sheet+'-'+issue.rowNumber+'-'+index}><strong>{issue.severity} · {issue.sheet}{issue.rowNumber?' · fila '+issue.rowNumber:''}</strong> · {issue.codigo||'—'}{issue.referenceValue?' · '+issue.referenceValue:''}<br/><span>{issue.message}</span></li>)}</ul>{preview.issues.length>25&&<p>Se muestran 25 de {preview.issues.length} observaciones.</p>}</div>}
   {preview&&(preview.unidentifiedBatchCodes??[]).some(codigo=>!authorizedBatchCodes.has(codigo))&&<div className="master-errors"><h3>Excepción controlada: partida ausente</h3><p>Softland reporta stock disponible positivo para {(preview.unidentifiedBatchCodes??[]).filter(codigo=>!authorizedBatchCodes.has(codigo)).length} SKU de partida sin Partida / Talla. La autorización crea una referencia explícita <code>EXC-SIN-PARTIDA:SKU</code>; no inventa una partida ni habilita ajustes de stock.</p>{role==='ADMIN'?<><label className="field"><span>Motivo de excepción (mínimo 10 caracteres)</span><textarea value={exceptionReason} onChange={event=>setExceptionReason(event.target.value)} disabled={busy}/></label><button className="button-secondary" type="button" disabled={busy||exceptionReason.trim().length<10} onClick={()=>void authorizeMissingBatchExceptions()}>AUTORIZAR EXCEPCIÓN CONTROLADA</button></>:<p>Solo un ADMIN asignado puede autorizar esta excepción con motivo y auditoría.</p>}</div>}
   {preview&&!masterImported&&<p>Confirma el Maestro SKU antes de importar la referencia. Los SKU que estén sólo en Partidas o Series quedarán como advertencia y no se habilitarán para conteo.</p>}
   <button className="button-primary" type="button" disabled={!canImport||busy} onClick={()=>void handleImport()}>{busy?'Procesando…':'CONFIRMAR REFERENCIA DE SISTEMA'}</button>
  </>}
  {inventoryStatus==='ABIERTO'&&<button className="button-primary" type="button" disabled={busy} onClick={()=>void handleMaterialize()}>{busy?'Procesando…':'GENERAR / ACTUALIZAR HALLAZGOS'}</button>}
  <p className="master-message" role="status">{message}</p>
 </section>
}

function Summary({label,value}:{label:string;value:number}){return <div className="master-summary__item"><span>{label}</span><strong>{value}</strong></div>}
