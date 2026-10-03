import { useCallback, useEffect, useState } from 'react'
import type { AppRole } from '../../domain/auth/contracts'
import { SupabaseReconciliationRepository, type ReconciliationSummary } from '../../services/supabase-reconciliation-repository'

const repo=new SupabaseReconciliationRepository()

export function SystemReferencePanel({inventoryId,inventoryStatus,onMaterialized}:{
 inventoryId:string
 inventoryStatus:string
 role:AppRole|null
 onMaterialized:()=>Promise<void>|void
}){
 const [summary,setSummary]=useState<ReconciliationSummary|null>(null)
 const [message,setMessage]=useState('')
 const [busy,setBusy]=useState(false)

 const refresh=useCallback(async()=>{
  if(!inventoryId)return
  try{
   const next=await repo.summary(inventoryId)
   setSummary(next)
   setMessage(next.source_reference?'Referencia RP disponible para conciliación.':'Sin referencia RP confirmada. Usa Carga de datos.')
  }catch(error){
   setMessage(error instanceof Error?error.message:'No fue posible consultar la referencia RP.')
  }

 },[inventoryId])

 useEffect(()=>{void refresh()},[refresh])

 async function handleMaterialize(){
  try{
   setBusy(true)
   const result=await repo.materialize(inventoryId)
   setMessage('Conciliación actualizada: '+result.created_count+' casos nuevos, '+result.existing_count+' casos abiertos para este snapshot.')
   await refresh()
   await onMaterialized()
  }catch(error){
   setMessage(error instanceof Error?error.message:'No fue posible materializar la conciliación.')
  }finally{setBusy(false)}
 }

 const source=summary?.source_reference??null
 return <section className="master-status" aria-labelledby="system-reference-title">
  <h2 id="system-reference-title">Referencia RP activa</h2>
  <p>Este panel es sólo de estado. La carga o reemplazo de archivos se realiza exclusivamente en <strong>Carga de datos</strong>.</p>

  {source?<dl>
   <div><dt>Versión</dt><dd>{source.reference_version}</dd></div>
   <div><dt>Referencias</dt><dd>{source.row_count}</dd></div>
   <div><dt>Fingerprint</dt><dd>{source.fingerprint}</dd></div>
   <div><dt>Origen</dt><dd>{source.source}</dd></div>
  </dl>:<p className="form-warning">No existe una referencia RP confirmada para este inventario.</p>}

  {(inventoryStatus==='BORRADOR'||inventoryStatus==='PREPARADO')&&<p className="supervision-note">Completa Maestro + RP desde el módulo Carga de datos antes de abrir el inventario.</p>}
  {inventoryStatus==='ABIERTO'&&<button className="button-primary" type="button" disabled={busy||!source} onClick={()=>void handleMaterialize()}>{busy?'PROCESANDO…':'GENERAR / ACTUALIZAR HALLAZGOS'}</button>}
  <p className="master-message" role="status">{message}</p>
 </section>
}
