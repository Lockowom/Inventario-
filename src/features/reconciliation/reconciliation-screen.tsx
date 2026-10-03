import { useCallback, useEffect, useMemo, useState } from 'react'
import { SupabaseReconciliationRepository, type ReconciliationRow, type RecountCandidate, type ReconciliationSummary } from '../../services/supabase-reconciliation-repository'
import { SupabaseSupervisionRepository } from '../../services/supabase-supervision-repository'
import { SystemReferencePanel } from './system-reference-panel'
import { ReconciliationTimeline } from './reconciliation-timeline'

const repo=new SupabaseReconciliationRepository()
const supervision=new SupabaseSupervisionRepository()
type Profile={role:'CONTADOR'|'ANALISTA'|'ADMIN'}
type Inventory={id:string;name:string;status:string}
type Disposition='SIN_AJUSTE'|'AJUSTE_PROPUESTO'|'ERROR_DIGITACION_CONFIRMADO'|'ALTA_EN_SISTEMA_PROPUESTA'|'BAJA_EN_SISTEMA_PROPUESTA'|'OTRO'
const dispositions:Disposition[]=['SIN_AJUSTE','AJUSTE_PROPUESTO','ERROR_DIGITACION_CONFIRMADO','ALTA_EN_SISTEMA_PROPUESTA','BAJA_EN_SISTEMA_PROPUESTA','OTRO']

export function ReconciliationScreen(){
 const [profile,setProfile]=useState<Profile|null>(null),[inventories,setInventories]=useState<Inventory[]>([]),[inventoryId,setInventoryId]=useState('')
 const [rows,setRows]=useState<ReconciliationRow[]>([]),[summary,setSummary]=useState<ReconciliationSummary|null>(null),[message,setMessage]=useState(''),[filter,setFilter]=useState('TODOS')
 const [reason,setReason]=useState<Record<string,string>>({})
 const [assignee,setAssignee]=useState<Record<string,string>>({})
 const [candidates,setCandidates]=useState<Record<string,RecountCandidate[]>>({})
 const [disposition,setDisposition]=useState<Record<string,Disposition>>({})
 useEffect(()=>{void Promise.all([supervision.myProfile(),supervision.inventories()]).then(([p,i])=>{setProfile(p as Profile);setInventories(i);setInventoryId(i[0]?.id??'')}).catch(e=>setMessage(e instanceof Error?e.message:'Conciliación no disponible.'))},[])
 const refresh=useCallback(async()=>{try{const [nextRows,nextSummary]=await Promise.all([repo.list(inventoryId),repo.summary(inventoryId)]);setRows(nextRows);setSummary(nextSummary);setMessage('')}catch(e){setMessage(e instanceof Error?e.message:'No fue posible cargar conciliación.')}},[inventoryId])
 useEffect(()=>{if(inventoryId&&(profile?.role==='ANALISTA'||profile?.role==='ADMIN')) void refresh()},[inventoryId,profile?.role,refresh])
 const visible=useMemo(()=>filter==='TODOS'?rows:rows.filter(r=>r.status===filter),[rows,filter])
 const selectedInventory=useMemo(()=>inventories.find(inventory=>inventory.id===inventoryId)??null,[inventories,inventoryId])
 const loadCandidates=useCallback(async(caseId:string,round:2|3)=>{const key=`${caseId}:${round}`;if(candidates[key])return;try{const list=await repo.candidates(caseId,round);setCandidates(current=>({...current,[key]:list}));if(list.length===1)setAssignee(current=>({...current,[caseId]:list[0]!.user_id}))}catch(e){setMessage(e instanceof Error?e.message:'No fue posible cargar candidatos.')}},[candidates])
 if(profile?.role==='CONTADOR') return null
 return <section className="supervision-screen" aria-labelledby="reconciliation-title">
  <header><p className="eyebrow">F11 · control de inventario</p><h1 id="reconciliation-title">CENTRO DE CONCILIACIÓN</h1><p>Una diferencia es un hallazgo a investigar; no se interpreta automáticamente como error del contador ni genera ajuste de stock.</p></header>
  <div className="supervision-actions"><label className="field"><span>Inventario</span><select value={inventoryId} onChange={e=>setInventoryId(e.target.value)}>{inventories.map(i=><option key={i.id} value={i.id}>{i.name} · {i.status}</option>)}</select></label><label className="field"><span>Estado</span><select value={filter} onChange={e=>setFilter(e.target.value)}><option>TODOS</option><option>PENDIENTE_ANALISIS</option><option>2DO_CONTEO_ASIGNADO</option><option>REQUIERE_3ER_CONTEO</option><option>3ER_CONTEO_ASIGNADO</option><option>FISICO_CONFIRMADO</option><option>RESUELTO</option></select></label><button className="button-secondary" onClick={()=>void refresh()}>ACTUALIZAR</button></div>
  {message&&<p className="form-warning" role="status">{message}</p>}
  {inventoryId&&selectedInventory&&<SystemReferencePanel inventoryId={inventoryId} inventoryStatus={selectedInventory.status} role={profile?.role??null} onMaterialized={refresh}/>}
  {summary&&<section className="supervision-summary" aria-label="Resumen conciliación">
   <SummaryMetric label="Casos abiertos" value={summary.summary.open}/>
   <SummaryMetric label="Pendiente análisis" value={summary.summary.pending_analysis}/>
   <SummaryMetric label="2.º conteo" value={summary.summary.second_recount}/>
   <SummaryMetric label="3.er conteo" value={summary.summary.third_recount}/>
   <SummaryMetric label="Físico confirmado" value={summary.summary.physical_confirmed}/>
   <SummaryMetric label="Resueltos" value={summary.summary.resolved}/>
  </section>}
  {summary?.source_reference&&<p className="supervision-note">Snapshot RP v{summary.source_reference.reference_version} · {summary.source_reference.row_count} referencias · fingerprint {summary.source_reference.fingerprint.slice(0,12)}…</p>}
  <div className="supervision-cards">{visible.map(r=><article key={r.id}><strong>{r.codigo}{r.reference_value?` · ${r.reference_value}`:''}</strong><span>{r.anomaly_type}</span><span>Sistema: {r.system_quantity} · Físico inicial: {r.physical_quantity} · Diferencia: {r.physical_quantity-r.system_quantity}</span><span>Estado: {r.status}</span>{r.confirmed_physical_quantity!==null&&<span>Físico confirmado: {r.confirmed_physical_quantity}</span>}
   {(r.status==='PENDIENTE_ANALISIS'||r.status==='REQUIERE_2DO_CONTEO')&&<><label className="field"><span>Contador para 2.º conteo</span><select value={assignee[r.id]??''} onFocus={()=>void loadCandidates(r.id,2)} onChange={e=>setAssignee({...assignee,[r.id]:e.target.value})}><option value="">Seleccionar contador</option>{(candidates[`${r.id}:2`]??[]).map(c=><option key={c.user_id} value={c.user_id}>{c.display_name}</option>)}</select></label><button className="button-secondary" disabled={!assignee[r.id]} onClick={()=>void repo.assignSecond(r.id,assignee[r.id]??'').then(refresh).catch(e=>setMessage(e.message))}>ASIGNAR 2.º CONTEO</button></>}
   {r.status==='REQUIERE_3ER_CONTEO'&&(profile?.role==='ANALISTA'||profile?.role==='ADMIN')&&<><label className="field"><span>Analista para 3.er conteo</span><select value={assignee[r.id]??''} onFocus={()=>void loadCandidates(r.id,3)} onChange={e=>setAssignee({...assignee,[r.id]:e.target.value})}><option value="">Seleccionar analista</option>{(candidates[`${r.id}:3`]??[]).map(c=><option key={c.user_id} value={c.user_id}>{c.display_name}</option>)}</select></label><button className="button-secondary" disabled={!assignee[r.id]} onClick={()=>void repo.assignThird(r.id,assignee[r.id]??'').then(refresh).catch(e=>setMessage(e.message))}>ASIGNAR 3.er CONTEO</button></>}
   {r.status==='FISICO_CONFIRMADO'&&profile?.role==='ANALISTA'&&<><label className="field"><span>Dictamen</span><select value={disposition[r.id]??''} onChange={e=>setDisposition({...disposition,[r.id]:e.target.value as Disposition})}><option value="">Seleccionar dictamen</option>{dispositions.map(value=><option key={value} value={value}>{value.replaceAll('_',' ')}</option>)}</select></label><label className="field"><span>Justificación de dictamen</span><textarea value={reason[r.id]??''} onChange={e=>setReason({...reason,[r.id]:e.target.value})}/></label><button className="button-primary" disabled={!disposition[r.id]||!(reason[r.id]??'').trim()} onClick={()=>{const selected=disposition[r.id];if(!selected)return;void repo.resolve(r.id,selected,reason[r.id]??'').then(refresh).catch(e=>setMessage(e.message))}}>REGISTRAR DICTAMEN Y CERRAR</button></>}
   {r.status==='RESUELTO'&&<span>Dictamen: {r.disposition} · {r.resolution_reason}</span>}<ReconciliationTimeline caseId={r.id}/></article>)}</div>
 </section>
}

function SummaryMetric({label,value}:{label:string;value:number}){return <div><span>{label}</span><strong>{value}</strong></div>}
