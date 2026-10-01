import { useState } from 'react'
import { SupabaseReconciliationRepository, type ReconciliationEvent } from '../../services/supabase-reconciliation-repository'

const repo=new SupabaseReconciliationRepository()

const labels:Record<string,string>={
 SECOND_ASSIGNED:'2.º conteo asignado',
 SECOND_RECORDED:'2.º conteo registrado',
 THIRD_ASSIGNED:'3.er conteo asignado',
 THIRD_RECORDED:'3.er conteo registrado',
 RESOLVED:'Conciliación resuelta',
}

export function ReconciliationTimeline({caseId}:{caseId:string}){
 const [open,setOpen]=useState(false)
 const [events,setEvents]=useState<ReconciliationEvent[]|null>(null)
 const [busy,setBusy]=useState(false)
 const [error,setError]=useState('')

 async function toggle(){
  if(open){setOpen(false);return}
  setOpen(true)
  if(events!==null)return
  try{
   setBusy(true)
   setError('')
   setEvents(await repo.events(caseId))
  }catch(cause){
   setError(cause instanceof Error?cause.message:'No fue posible cargar la trazabilidad.')
  }finally{setBusy(false)}
 }

 return <section aria-label="Trazabilidad de conciliación">
  <button className="button-secondary" type="button" onClick={()=>void toggle()}>{open?'OCULTAR TRAZABILIDAD':'VER TRAZABILIDAD'}</button>
  {open&&<div className="reconciliation-timeline">
   {busy&&<p role="status">Cargando trazabilidad…</p>}
   {error&&<p className="form-warning" role="status">{error}</p>}
   {!busy&&!error&&events?.length===0&&<p>Sin eventos de reconteo todavía.</p>}
   {!busy&&!error&&events?.map(event=><article key={event.id} className="reconciliation-timeline__event">
    <strong>{labels[event.event_type]??event.event_type.replaceAll('_',' ')}</strong>
    <span>{event.actor_display_name} · {formatTimestamp(event.created_at)}</span>
    <span>{eventDetail(event)}</span>
   </article>)}
  </div>}
 </section>
}

function eventDetail(event:ReconciliationEvent){
 if(event.event_type==='SECOND_ASSIGNED') return event.target_display_name?'Asignado a '+event.target_display_name:'Asignación registrada.'
 if(event.event_type==='THIRD_ASSIGNED') return event.target_display_name?'Asignado a '+event.target_display_name:'Asignación registrada.'
 if(event.event_type==='SECOND_RECORDED'){
  const value=typeof event.payload.result_status==='string'?event.payload.result_status.replaceAll('_',' '):''
  return value?'Resultado: '+value:'2.º conteo registrado.'
 }
 if(event.event_type==='THIRD_RECORDED'){
  const value=event.payload.confirmed_physical_quantity
  return typeof value==='number'?'Físico confirmado: '+value:'3.er conteo registrado.'
 }
 if(event.event_type==='RESOLVED'){
  const disposition=typeof event.payload.disposition==='string'?event.payload.disposition.replaceAll('_',' '):'Dictamen registrado'
  const reason=typeof event.payload.reason==='string'?event.payload.reason:''
  return reason?disposition+' · '+reason:disposition
 }
 return 'Evento registrado.'
}

function formatTimestamp(value:string){
 const parsed=new Date(value)
 if(Number.isNaN(parsed.getTime()))return value
 return parsed.toLocaleString('es-CL',{dateStyle:'short',timeStyle:'short'})
}
