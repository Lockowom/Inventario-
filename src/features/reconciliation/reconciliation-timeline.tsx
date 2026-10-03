import { useEffect, useState } from 'react'
import { SupabaseReconciliationRepository, type ReconciliationEvent } from '../../services/supabase-reconciliation-repository'

const repo=new SupabaseReconciliationRepository()

const labels:Record<string,string>={
 SECOND_ASSIGNED:'C2 iniciado',
 SECOND_RECORDED:'C2 finalizado',
 THIRD_ASSIGNED:'C3 iniciado',
 THIRD_RECORDED:'C3 finalizado',
 RESOLVED:'Conciliación resuelta',
}

export function ReconciliationTimeline({caseId}:{caseId:string}){
 const [events,setEvents]=useState<ReconciliationEvent[]|null>(null)
 const [error,setError]=useState('')

 useEffect(()=>{
  let active=true
  setEvents(null);setError('')
  void repo.events(caseId)
   .then(items=>{if(active)setEvents(items)})
   .catch(cause=>{if(active)setError(cause instanceof Error?cause.message:'No fue posible cargar la trazabilidad.')})
  return()=>{active=false}
 },[caseId])

 if(error)return <p className="form-warning" role="status">{error}</p>
 if(events===null)return <p role="status">Cargando trazabilidad…</p>
 if(events.length===0)return <p>Sin eventos de reconteo todavía.</p>

 return <div className="reconciliation-timeline" aria-label="Trazabilidad de conciliación">
  {events.map(event=><article key={event.id} className="reconciliation-timeline__event">
   <strong>{labels[event.event_type]??event.event_type.replaceAll('_',' ')}</strong>
   <span>{event.actor_display_name} · {formatTimestamp(event.created_at)}</span>
   <span>{eventDetail(event)}</span>
  </article>)}
 </div>
}

function eventDetail(event:ReconciliationEvent){
 if(event.event_type==='SECOND_ASSIGNED'||event.event_type==='THIRD_ASSIGNED'){
  return event.target_display_name?'Tomado por '+event.target_display_name:'Misión tomada desde la cola.'
 }
 if(event.event_type==='SECOND_RECORDED'||event.event_type==='THIRD_RECORDED'){
  const total=event.payload.total_quantity
  const locations=event.payload.observation_count
  const result=typeof event.payload.result_status==='string'?event.payload.result_status.replaceAll('_',' '):''
  const parts=[
   typeof total==='number'?'Total físico: '+total:null,
   typeof locations==='number'?'Ubicaciones: '+locations:null,
   result?'Resultado: '+result:null,
  ].filter(Boolean)
  return parts.join(' · ')||'Reconteo finalizado.'
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
