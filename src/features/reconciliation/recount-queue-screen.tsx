import { useCallback, useEffect, useState } from 'react'
import type { SyncCoordinator } from '../../domain/sync/sync-coordinator'
import { savePhysicalCount } from '../../domain/count/save-physical-count'
import { emptyPhysicalCountDraft } from '../counting/form-state'
import type { CountingRuntime } from '../counting/counting-screen'
import { SupabaseReconciliationRepository, type RecountMission, type RecountQueue } from '../../services/supabase-reconciliation-repository'

const repo=new SupabaseReconciliationRepository()

export function RecountQueueScreen({runtime,syncCoordinator}:{runtime:CountingRuntime|null;syncCoordinator:SyncCoordinator|null}){
 const [queue,setQueue]=useState<RecountQueue|null>(null)
 const [mission,setMission]=useState<RecountMission|null>(null)
 const [ubicacion,setUbicacion]=useState('')
 const [cantidad,setCantidad]=useState('')
 const [busy,setBusy]=useState(false)
 const [message,setMessage]=useState('')
 const inventoryId=runtime?.context.inventoryId??''

 const refresh=useCallback(async()=>{
  if(!inventoryId)return
  const next=await repo.recountQueue(inventoryId)
  setQueue(next);setMission(next.active)
 },[inventoryId])

 useEffect(()=>{void refresh().catch(()=>setMessage('No fue posible cargar la cola de reconteos.'))},[refresh])

 if(!runtime)return <section><h1>RECONTEOS</h1><p>Necesitas un inventario ABIERTO para trabajar misiones de reconteo.</p></section>

 async function claim(){
  try{
   setBusy(true)
   const next=await repo.claimNextMission(inventoryId)
   setMission(next)
   setMessage(next?'Misión C'+next.round+' asignada. Conteo ciego activo.':'No hay misiones disponibles para tu rol.')
  }catch(error){setMessage(error instanceof Error?error.message:'No fue posible asignar una misión.')}
  finally{setBusy(false)}
 }

 async function observe(){
  if(!mission)return
  try{
   setBusy(true)
   const draft={...emptyPhysicalCountDraft,ubicacion,codigo:mission.codigo,
    serie:mission.reference_type==='SERIAL'?(mission.reference_value??''):'',
    partida:mission.reference_type==='PARTIDA'?(mission.reference_value??''):'',
    cantidadContada:mission.reference_type==='SERIAL'?'1':cantidad}
   const saved=await savePhysicalCount(runtime.context,draft,runtime)
   if(!syncCoordinator)throw new Error('Sincronización no disponible.')
   await syncCoordinator.runInventorySync(inventoryId,{forceRetry:true})
   const updated=await repo.addMissionObservation(mission.id,saved.record.clientCountId)
   setMission(updated);setUbicacion('');setCantidad('')
   setMessage('Ubicación '+saved.record.ubicacion+' agregada. Continúa buscando o finaliza la misión.')
  }catch(error){setMessage(error instanceof Error?error.message:'No fue posible registrar la observación.')}
  finally{setBusy(false)}
 }

 async function finish(){
  if(!mission)return
  try{
   setBusy(true)
   const result=await repo.completeMission(mission.id)
   setMission(null)
   setMessage(result.next_round===3?'C2 cerrado. C1 y C2 no coinciden: C3 fue creado automáticamente.':'C'+result.round+' cerrado. Físico confirmado: '+(result.confirmed_physical_quantity??result.total_quantity)+'.')
   await refresh()
  }catch(error){setMessage(error instanceof Error?error.message:'No fue posible finalizar la misión.')}
  finally{setBusy(false)}
 }

 return <section className="recount-queue" aria-labelledby="recount-title">
  <header><p className="eyebrow">WMS · tarea dirigida</p><h1 id="recount-title">RECONTEOS</h1><p>Una misión agrupa una referencia completa. Un SKU/lote puede aparecer en varias ubicaciones; el total se calcula al finalizar.</p></header>
  {!mission&&<div className="recount-queue__empty"><strong>{queue?.queued_count??0} misiones disponibles</strong><button className="button-primary" disabled={busy||!queue?.queued_count} onClick={()=>void claim()}>INICIAR SIGUIENTE</button></div>}
  {mission&&<article className="recount-mission">
   <h2>C{mission.round} · {mission.codigo}</h2>
   <p>{mission.descripcion}</p>
   <strong>{mission.reference_type==='PARTIDA'?'Partida/Lote: ':mission.reference_type==='SERIAL'?'Serie: ':'Referencia: '}{mission.reference_value??'SKU'}</strong>
   <p className="form-warning">CONTEO CIEGO · No se muestran Softland, C1, C2 ni diferencias.</p>
   <h3>Ubicaciones conocidas</h3>
   <div className="data-load-code-list">{mission.known_locations.length?mission.known_locations.map(x=><code key={x}>{x}</code>):<span>Sin ubicaciones previas.</span>}</div>
   <label className="field"><span>Ubicación encontrada</span><input value={ubicacion} onChange={e=>setUbicacion(e.target.value.toUpperCase())} placeholder="A-21-03"/></label>
   {mission.reference_type!=='SERIAL'&&<label className="field"><span>Cantidad en esta ubicación</span><input value={cantidad} inputMode="numeric" onChange={e=>setCantidad(e.target.value)}/></label>}
   <button className="button-secondary" disabled={busy||!ubicacion.trim()||(mission.reference_type!=='SERIAL'&&!cantidad.trim())} onClick={()=>void observe()}>AGREGAR UBICACIÓN</button>
   <h3>Observaciones C{mission.round}</h3>
   <ul>{mission.observations.map(o=><li key={o.id}><strong>{o.ubicacion}</strong> · {o.cantidad} un.</li>)}</ul>
   <button className="button-primary" disabled={busy||mission.observations.length===0} onClick={()=>void finish()}>FINALIZAR C{mission.round}</button>
  </article>}
  {message&&<p className="master-message" role="status">{message}</p>}
 </section>
}
