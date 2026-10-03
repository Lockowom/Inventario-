import { useState } from 'react'
import { SupabaseReconciliationRepository, type ReconciliationSummary } from '../../services/supabase-reconciliation-repository'

const repo=new SupabaseReconciliationRepository()

export function SystemReferencePanel({
 inventoryId,
 inventoryStatus,
 summary,
 onMaterialized,
}:{
 inventoryId:string
 inventoryStatus:string
 summary:ReconciliationSummary|null
 onMaterialized:()=>Promise<void>|void
}){
 const [message,setMessage]=useState('')
 const [busy,setBusy]=useState(false)

 async function handleMaterialize(){
  try{
   setBusy(true)
   const result=await repo.materialize(inventoryId)
   await onMaterialized()
   setMessage('Conciliación actualizada: '+result.created_count+' casos nuevos, '+result.existing_count+' casos abiertos para este snapshot.')
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

  {(inventoryStatus==='BORRADOR'||inventoryStatus==='PREPARADO')&&<p className="reconciliation-note">Completa Maestro + RP desde el módulo Carga de datos antes de abrir el inventario.</p>}
  {inventoryStatus==='ABIERTO'&&<button className="button-primary" type="button" disabled={busy||!source} onClick={()=>void handleMaterialize()}>{busy?'PROCESANDO…':'GENERAR / ACTUALIZAR HALLAZGOS'}</button>}
  {message&&<p className="reconciliation-message" role="status">{message}</p>}
 </section>
}
