import { useCallback, useEffect, useMemo, useState } from 'react'
import { SupabaseReconciliationRepository, type ReconciliationRow, type ReconciliationSummary } from '../../services/supabase-reconciliation-repository'
import { SupabaseSupervisionRepository } from '../../services/supabase-supervision-repository'
import { SystemReferencePanel } from './system-reference-panel'
import { ReconciliationTimeline } from './reconciliation-timeline'
import { LiveReconciliationWorkspace } from './live-reconciliation-workspace'

const repo=new SupabaseReconciliationRepository()
const supervision=new SupabaseSupervisionRepository()
type Profile={role:'CONTADOR'|'ANALISTA'|'ADMIN'}
type Inventory={id:string;name:string;status:string}
type Disposition='SIN_AJUSTE'|'AJUSTE_PROPUESTO'|'ERROR_DIGITACION_CONFIRMADO'|'ALTA_EN_SISTEMA_PROPUESTA'|'BAJA_EN_SISTEMA_PROPUESTA'|'OTRO'
const dispositions:Disposition[]=['SIN_AJUSTE','AJUSTE_PROPUESTO','ERROR_DIGITACION_CONFIRMADO','ALTA_EN_SISTEMA_PROPUESTA','BAJA_EN_SISTEMA_PROPUESTA','OTRO']

export function ReconciliationScreen(){
 const [profile,setProfile]=useState<Profile|null>(null)
 const [inventories,setInventories]=useState<Inventory[]>([])
 const [inventoryId,setInventoryId]=useState('')
 const [rows,setRows]=useState<ReconciliationRow[]>([])
 const [summary,setSummary]=useState<ReconciliationSummary|null>(null)
 const [message,setMessage]=useState('')
 const [filter,setFilter]=useState('TODOS')
 const [expanded,setExpanded]=useState<string|null>(null)
 const [reason,setReason]=useState<Record<string,string>>({})
 const [disposition,setDisposition]=useState<Record<string,Disposition>>({})

 useEffect(()=>{void Promise.all([supervision.myProfile(),supervision.inventories()]).then(([p,i])=>{setProfile(p as Profile);setInventories(i);setInventoryId(i[0]?.id??'')}).catch(e=>setMessage(e instanceof Error?e.message:'Conciliación no disponible.'))},[])

 const refresh=useCallback(async()=>{
  if(!inventoryId)return
  try{
   const [nextRows,nextSummary]=await Promise.all([repo.list(inventoryId),repo.summary(inventoryId)])
   setRows(nextRows);setSummary(nextSummary);setMessage('')
  }catch(e){setMessage(e instanceof Error?e.message:'No fue posible cargar conciliación.')}
 },[inventoryId])

 useEffect(()=>{if(inventoryId&&(profile?.role==='ANALISTA'||profile?.role==='ADMIN'))void refresh()},[inventoryId,profile?.role,refresh])

 const visible=useMemo(()=>filter==='TODOS'?rows:rows.filter(r=>r.status===filter),[rows,filter])
 const selectedInventory=useMemo(()=>inventories.find(i=>i.id===inventoryId)??null,[inventories,inventoryId])

 if(profile?.role==='CONTADOR')return null

 return <section className="reconciliation-screen" aria-labelledby="reconciliation-title">
  <header>
   <p className="eyebrow">F15 · conciliación por misiones</p>
   <h1 id="reconciliation-title">CENTRO DE CONCILIACIÓN</h1>
   <p>La conciliación trabaja por SKU + lote/serie. Las ubicaciones se acumulan dentro de cada ronda física. Los casos definitivos nacen al finalizar C1; C2 y C3 se ejecutan como misiones ciegas desde Reconteos.</p>
  </header>

  <div className="reconciliation-actions">
   <label className="field"><span>Inventario</span><select value={inventoryId} onChange={e=>setInventoryId(e.target.value)}>{inventories.map(i=><option key={i.id} value={i.id}>{i.name} · {i.status}</option>)}</select></label>
   <label className="field"><span>Estado</span><select value={filter} onChange={e=>setFilter(e.target.value)}><option>TODOS</option><option>REQUIERE_2DO_CONTEO</option><option>2DO_CONTEO_ASIGNADO</option><option>REQUIERE_3ER_CONTEO</option><option>3ER_CONTEO_ASIGNADO</option><option>FISICO_CONFIRMADO</option><option>RESUELTO</option></select></label>
   <button className="button-secondary" onClick={()=>void refresh()}>ACTUALIZAR</button>
  </div>

  {message&&<p className="form-warning" role="status">{message}</p>}
  {inventoryId&&selectedInventory&&<SystemReferencePanel inventoryStatus={selectedInventory.status} summary={summary}/>} 
  {inventoryId&&<LiveReconciliationWorkspace inventoryId={inventoryId}/>}

  <section className="reconciliation-cases">
   <div className="reconciliation-cases__header"><div><h2>CASOS DE INVESTIGACIÓN</h2><p>Al finalizar C1, cada discrepancia final genera una misión C2. Sólo escala a C3 cuando C1 y C2 no coinciden.</p></div><strong>{visible.length}</strong></div>

   {summary&&<section className="reconciliation-summary" aria-label="Resumen conciliación">
    <SummaryMetric label="Abiertos" value={summary.summary.open}/>
    <SummaryMetric label="C2" value={summary.summary.second_recount}/>
    <SummaryMetric label="C3" value={summary.summary.third_recount}/>
    <SummaryMetric label="Físico confirmado" value={summary.summary.physical_confirmed}/>
    <SummaryMetric label="Resueltos" value={summary.summary.resolved}/>
   </section>}

   <div className="reconciliation-compact-list">
    {visible.map(item=><article key={item.id} className="reconciliation-compact-card">
     <button type="button" className="reconciliation-compact-card__summary" onClick={()=>setExpanded(current=>current===item.id?null:item.id)}>
      <span><strong>{item.codigo}</strong>{item.reference_value&&<small>{item.reference_value}</small>}</span>
      <span>{item.anomaly_type.replaceAll('_',' ')}</span>
      <span className="reconciliation-compact-card__status">{item.status.replaceAll('_',' ')}</span>
      <span>{expanded===item.id?'OCULTAR':'VER'}</span>
     </button>

     {expanded===item.id&&<div className="reconciliation-compact-card__detail">
      <dl>
       <div><dt>Softland</dt><dd>{item.system_quantity}</dd></div>
       <div><dt>C1 físico total</dt><dd>{item.physical_quantity}</dd></div>
       <div><dt>Diferencia C1</dt><dd>{item.physical_quantity-item.system_quantity}</dd></div>
       {item.confirmed_physical_quantity!==null&&<div><dt>Físico confirmado</dt><dd>{item.confirmed_physical_quantity}</dd></div>}
      </dl>
      <p className="reconciliation-note">Las cantidades por ubicación no se comparan contra Softland individualmente. C1/C2/C3 suman todas las ubicaciones de esta misma referencia.</p>

      {item.status==='FISICO_CONFIRMADO'&&profile?.role==='ANALISTA'&&<>
       <label className="field"><span>Dictamen</span><select value={disposition[item.id]??''} onChange={e=>setDisposition({...disposition,[item.id]:e.target.value as Disposition})}><option value="">Seleccionar dictamen</option>{dispositions.map(value=><option key={value} value={value}>{value.replaceAll('_',' ')}</option>)}</select></label>
       <label className="field"><span>Justificación</span><textarea value={reason[item.id]??''} onChange={e=>setReason({...reason,[item.id]:e.target.value})}/></label>
       <button className="button-primary" disabled={!disposition[item.id]||!(reason[item.id]??'').trim()} onClick={()=>{const selected=disposition[item.id];if(!selected)return;void repo.resolve(item.id,selected,reason[item.id]??'').then(refresh).catch(e=>setMessage(e.message))}}>REGISTRAR DICTAMEN</button>
      </>}
      {item.status==='RESUELTO'&&<p><strong>Dictamen:</strong> {item.disposition?.replaceAll('_',' ')} · {item.resolution_reason}</p>}
      <details><summary>Ver historial</summary><ReconciliationTimeline caseId={item.id}/></details>
     </div>}
    </article>)}
   </div>
   {visible.length===0&&<p>No hay casos para este filtro.</p>}
  </section>
 </section>
}

function SummaryMetric({label,value}:{label:string;value:number}){return <div><span>{label}</span><strong>{value}</strong></div>}
