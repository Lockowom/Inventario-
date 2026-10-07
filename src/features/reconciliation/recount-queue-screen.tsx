import { useCallback, useEffect, useMemo, useState } from 'react'
import { isLocalMasterCurrent, refreshMasterSnapshot } from '../../domain/master/offline-master'
import type { ActiveCountingContext } from '../../domain/count/save-physical-count'
import { savePhysicalCount } from '../../domain/count/save-physical-count'
import { SupabaseMasterSkuRepository } from '../../services/supabase-master-sku-repository'
import { SupabaseReconciliationRepository, type RecountMission, type RecountQueue } from '../../services/supabase-reconciliation-repository'
import { SupabaseSupervisionRepository } from '../../services/supabase-supervision-repository'
import { createCountingRuntime, createSyncCoordinator, getMasterSkuRepository } from '../counting/counting-runtime'
import { emptyPhysicalCountDraft } from '../counting/form-state'
import type { CaptureGate } from '../counting/counting-screen'

type Inventory={id:string;name:string;status:string}
type Profile={user_id:string;display_name:string;role:'CONTADOR'|'ANALISTA'|'ADMIN';active:boolean}

const reconciliation=new SupabaseReconciliationRepository()
const supervision=new SupabaseSupervisionRepository()
const remoteMasters=new SupabaseMasterSkuRepository()

export function RecountQueueScreen({ captureGate }: { captureGate?: CaptureGate }){
 const [profile,setProfile]=useState<Profile|null>(null)
 const [inventories,setInventories]=useState<Inventory[]>([])
 const [inventoryId,setInventoryId]=useState('')
 const [queue,setQueue]=useState<RecountQueue|null>(null)
 const [mission,setMission]=useState<RecountMission|null>(null)
 const [context,setContext]=useState<ActiveCountingContext|null>(null)
 const [ubicacion,setUbicacion]=useState('')
 const [cantidad,setCantidad]=useState('')
 const [busy,setBusy]=useState(false)
 const [message,setMessage]=useState('Cargando contexto de reconteos…')

 const selectedInventory=useMemo(()=>inventories.find(item=>item.id===inventoryId)??null,[inventories,inventoryId])
 const runtime=useMemo(()=>context?createCountingRuntime(context):null,[context])
 const syncCoordinator=useMemo(()=>context?createSyncCoordinator(context.userId):null,[context])

 useEffect(()=>{
  let active=true
  void Promise.all([supervision.myProfile(),supervision.inventories()])
   .then(([nextProfile,rows])=>{
    if(!active)return
    const open=(rows as Inventory[]).filter(item=>item.status==='ABIERTO')
    setProfile(nextProfile as Profile)
    setInventories(open)
    setInventoryId(current=>current||open[0]?.id||'')
    if(open.length===0)setMessage('No hay inventarios ABIERTO autorizados para tu usuario.')
   })
   .catch(error=>{if(active)setMessage(error instanceof Error?error.message:'No fue posible cargar el contexto de reconteos.')})
  return()=>{active=false}
 },[])

 const refresh=useCallback(async(announce=true)=>{
  if(!inventoryId||!profile)return
  setBusy(true)
  try{
   const nextQueue=await reconciliation.recountQueue(inventoryId)
   setContext({userId:profile.user_id,inventoryId,inventoryStatus:'ABIERTO'})
   setQueue(nextQueue)
   setMission(nextQueue.active)
   if(announce)setMessage(nextQueue.active
    ? 'Misión C'+nextQueue.active.round+' activa.'
    : !nextQueue.c1_completed
      ? 'C1 todavía está EN CURSO. Los reconteos se habilitan cuando ANALISTA/ADMIN finalice C1 desde Supervisión.'
      : nextQueue.queued_count>0
        ? nextQueue.queued_count+' misiones C'+nextQueue.round+' disponibles para tu rol.'
        : nextQueue.round===3
          ? 'Tu rol ejecuta C3. Los C2 pendientes se atienden desde cuentas CONTADOR.'
          : 'No hay misiones C2 disponibles para este contador en el inventario.')
  }catch(error){
   setContext(null);setQueue(null);setMission(null)
   setMessage(error instanceof Error?error.message:'No fue posible cargar la cola de reconteos.')
  }finally{setBusy(false)}
 },[inventoryId,profile])

 useEffect(()=>{if(inventoryId&&profile)void refresh()},[inventoryId,profile,refresh])

 async function claim(){
  if(captureGate?.blocked){setMessage(captureGate.message??'Captura bloqueada por Health Check.');return}
  if(!context)return
  try{
   setBusy(true)
   const next=await reconciliation.claimNextMission(context.inventoryId)
   setMission(next)
   setQueue(current=>current?{...current,active:next,queued_count:Math.max(0,current.queued_count-(next?1:0))}:current)
   setUbicacion('');setCantidad('')
   setMessage(next?'Misión C'+next.round+' asignada. Conteo ciego activo.':'No hay misiones disponibles para tu rol.')
  }catch(error){setMessage(error instanceof Error?error.message:'No fue posible asignar una misión.')}
  finally{setBusy(false)}
 }

 async function observe(){
  if(captureGate?.blocked){setMessage(captureGate.message??'Captura bloqueada por Health Check.');return}
  if(!mission||!context||!runtime||!syncCoordinator)return
  try{
   setBusy(true)
   const localMasters=getMasterSkuRepository()
   if(!await isLocalMasterCurrent(context.inventoryId,remoteMasters,localMasters)){
    await refreshMasterSnapshot(context.inventoryId,remoteMasters,localMasters)
   }
   const draft={...emptyPhysicalCountDraft,ubicacion,codigo:mission.codigo,
    serie:mission.reference_type==='SERIAL'?(mission.reference_value??''):'',
    partida:mission.reference_type==='PARTIDA'?(mission.reference_value??''):'',
    cantidadContada:mission.reference_type==='SERIAL'?'1':cantidad}
   const previousObservations=mission.observations.length
   const saved=await savePhysicalCount(context,draft,runtime)
   await syncCoordinator.runInventorySync(context.inventoryId,{forceRetry:true})
   const nextQueue=await reconciliation.recountQueue(context.inventoryId)
   const updated=nextQueue.active
   if(!updated||updated.id!==mission.id||updated.observations.length<=previousObservations){
    throw new Error('El conteo quedó guardado localmente, pero el servidor aún no lo vinculó a la misión. Reintenta la sincronización antes de continuar.')
   }
   setMission(updated);setQueue(nextQueue)
   setUbicacion('');setCantidad('')
   setMessage('Ubicación '+saved.record.ubicacion+' agregada. Continúa buscando la misma referencia o finaliza la misión.')
  }catch(error){setMessage(error instanceof Error?error.message:'No fue posible registrar la observación.')}
  finally{setBusy(false)}
 }

 async function finish(){
  if(captureGate?.blocked){setMessage(captureGate.message??'Captura bloqueada por Health Check.');return}
  if(!mission)return
  try{
   setBusy(true)
   const result=await reconciliation.completeMission(mission.id)
   setMission(null);setUbicacion('');setCantidad('')
   await refresh(false)
   setMessage(result.next_round===3
    ? 'C2 cerrado. C1 y C2 no coinciden: C3 fue creado automáticamente.'
    : 'C'+result.round+' cerrado. Físico confirmado: '+(result.confirmed_physical_quantity??result.total_quantity)+'.')
  }catch(error){setMessage(error instanceof Error?error.message:'No fue posible finalizar la misión.')}
  finally{setBusy(false)}
 }

 async function finishZero(){
  if(captureGate?.blocked){setMessage(captureGate.message??'Captura bloqueada por Health Check.');return}
  if(!mission||mission.observations.length>0)return
  if(!window.confirm('Confirma que buscaste esta referencia y no encontraste ninguna unidad física. El resultado de esta ronda será 0.'))return
  try{
   setBusy(true)
   const result=await reconciliation.completeMissionZero(mission.id)
   setMission(null);setUbicacion('');setCantidad('')
   await refresh(false)
   setMessage(result.next_round===3
    ? 'Ronda confirmada en 0. Como no coincide con la ronda anterior, se creó C3.'
    : 'C'+result.round+' confirmado en 0 unidades físicas.')
  }catch(error){setMessage(error instanceof Error?error.message:'No fue posible confirmar la referencia como no encontrada.')}
  finally{setBusy(false)}
 }

 return <section className="recount-queue" aria-labelledby="recount-title">
  <header>
   <p className="eyebrow">WMS · tarea dirigida</p>
   <h1 id="recount-title">RECONTEOS</h1>
   <p>Una misión agrupa una referencia completa. Un SKU/lote puede aparecer en varias ubicaciones; el total se calcula sólo al finalizar.</p>
  </header>
  {captureGate?.blocked&&<p className="form-error" role="alert">{captureGate.message??'Captura bloqueada por Health Check.'}</p>}

  {inventories.length>0&&<label className="field"><span>Inventario abierto</span><select value={inventoryId} disabled={busy} onChange={event=>setInventoryId(event.target.value)}>{inventories.map(item=><option key={item.id} value={item.id}>{item.name}</option>)}</select></label>}

  {selectedInventory&&profile&&<p className="recount-queue__context">{selectedInventory.name} · {profile.display_name} · {profile.role}</p>}

  {!mission&&context&&<div className="recount-queue__empty">
   <div><strong>{queue?.queued_count??0} misiones disponibles</strong><small>{queue?.round?' · C'+queue.round:''}</small></div>
   <button className="button-primary" disabled={busy||captureGate?.blocked||!queue?.queued_count} onClick={()=>void claim()}>{busy?'CARGANDO…':'INICIAR SIGUIENTE'}</button>
  </div>}

  {mission&&<article className="recount-mission">
   <h2>C{mission.round} · {mission.codigo}</h2>
   <p>{mission.descripcion}</p>
   <strong>{mission.reference_type==='PARTIDA'?'Partida/Lote: ':mission.reference_type==='SERIAL'?'Serie: ':'Referencia: '}{mission.reference_value??'SKU'}</strong>
   <p className="form-warning">CONTEO CIEGO · No se muestran Softland, C1, C2 ni diferencias.</p>

   <h3>Ubicaciones conocidas</h3>
   <div className="recount-mission__locations">{mission.known_locations.length?mission.known_locations.map(item=><code key={item}>{item}</code>):<span>Sin ubicaciones previas.</span>}</div>

   <label className="field"><span>Ubicación encontrada</span><input value={ubicacion} disabled={busy||captureGate?.blocked} onChange={event=>setUbicacion(event.target.value.toUpperCase())} placeholder="A-21-03"/></label>
   {mission.reference_type!=='SERIAL'&&<label className="field"><span>Cantidad en esta ubicación</span><input value={cantidad} disabled={busy||captureGate?.blocked} inputMode="numeric" onChange={event=>setCantidad(event.target.value)}/></label>}
   <button className="button-secondary" disabled={busy||captureGate?.blocked||!ubicacion.trim()||(mission.reference_type!=='SERIAL'&&!cantidad.trim())} onClick={()=>void observe()}>AGREGAR UBICACIÓN</button>

   <h3>Observaciones C{mission.round}</h3>
   {mission.observations.length?<ul>{mission.observations.map(item=><li key={item.id}><strong>{item.ubicacion}</strong><span>{item.cantidad} un.</span></li>)}</ul>:<p>Aún no hay observaciones registradas en esta ronda.</p>}

   {mission.observations.length===0&&<button className="button-secondary" disabled={busy||captureGate?.blocked} onClick={()=>void finishZero()}>CONFIRMAR 0 · NO ENCONTRADO</button>}
   <button className="button-primary" disabled={busy||captureGate?.blocked||mission.observations.length===0} onClick={()=>void finish()}>FINALIZAR C{mission.round}</button>
  </article>}

  <p className="recount-queue__message" role="status">{message}</p>
 </section>
}
