import { useCallback, useEffect, useMemo, useState } from 'react'
import { SupabaseReconciliationRepository, type LiveReconciliationRow, type LiveReconciliationStatus, type LiveReconciliationWorkspace } from '../../services/supabase-reconciliation-repository'

const repo=new SupabaseReconciliationRepository()
const statuses:LiveReconciliationStatus[]=['CUADRADO','DIFERENCIA','NUEVO_LOTE_SERIE','FUERA_DE_DISPONIBLE','VENCIMIENTO_DISTINTO']

function number(value:number){return new Intl.NumberFormat('es-CL').format(value)}
function statusLabel(status:LiveReconciliationStatus){return status.replaceAll('_',' ')}
function reference(row:LiveReconciliationRow){return row.reference_value??'Sin lote / serie'}

export function LiveReconciliationWorkspace({inventoryId}:{inventoryId:string}){
 const [workspace,setWorkspace]=useState<LiveReconciliationWorkspace|null>(null)
 const [search,setSearch]=useState(''),[status,setStatus]=useState('TODOS'),[selected,setSelected]=useState<LiveReconciliationRow|null>(null),[message,setMessage]=useState(''),[loading,setLoading]=useState(false)
 const refresh=useCallback(async()=>{
  setLoading(true)
  try{const next=await repo.liveWorkspace(inventoryId,search.trim()||null,status);setWorkspace(next);setSelected(current=>next.rows.find(row=>row.codigo===current?.codigo&&row.reference_value===current.reference_value)??next.rows[0]??null);setMessage('')}catch(error){setMessage(error instanceof Error?error.message:'No fue posible cargar la vista en vivo.')}finally{setLoading(false)}
 },[inventoryId,search,status])
 useEffect(()=>{void refresh()},[refresh])
 useEffect(()=>{const timer=window.setInterval(()=>void refresh(),15000);return()=>window.clearInterval(timer)},[refresh])
 const metrics=workspace?.metrics
 const progress=useMemo(()=>metrics&&metrics.total_skus>0?Math.round((metrics.counted_skus/metrics.total_skus)*100):0,[metrics])
 return <section className="live-reconciliation" aria-labelledby="live-reconciliation-title">
  <header className="live-reconciliation__header"><div><p className="eyebrow">LECTURA OPERATIVA · SOLO DISPONIBLE</p><h2 id="live-reconciliation-title">CONCILIACIÓN EN VIVO</h2><p>El físico se compara únicamente contra <strong>Disponible</strong>. Reserva, transitorio, consignación y Stock Total no se suman ni crean ajustes automáticos.</p></div><button className="button-secondary" disabled={loading} onClick={()=>void refresh()}>{loading?'ACTUALIZANDO…':'ACTUALIZAR'}</button></header>
  {message&&<p className="form-warning" role="status">{message}</p>}
  {metrics&&<section className="live-reconciliation__metrics" aria-label="Indicadores de conciliación en vivo">
   <Metric label="SKU contados" value={`${metrics.counted_skus} / ${metrics.total_skus}`} detail={`${progress}% del catálogo de referencia`} tone="info"/>
   <Metric label="Ítems cuadrados" value={number(metrics.matched_items)} detail="Disponible = físico" tone="success"/>
   <Metric label="Con diferencia" value={number(metrics.difference_items)} detail="Requieren investigación" tone="warning"/>
   <Metric label="Lotes / series nuevos" value={number(metrics.new_references)} detail="No existen en Disponible" tone="error"/>
   <Metric label="Fuera de Disponible" value={number(metrics.non_available_items)} detail="Existe en otro estado Softland" tone="warning"/>
   <Metric label="Unidades físicas" value={number(metrics.counted_units)} detail={`Disponible: ${number(metrics.available_units)} · Dif.: ${metrics.difference_units>0?'+':''}${number(metrics.difference_units)}`} tone="neutral"/>
  </section>}
  <div className="live-reconciliation__controls"><label className="field"><span>Buscar SKU, producto o lote</span><input value={search} onChange={event=>setSearch(event.target.value)} placeholder="Código, producto, partida o serie"/></label><label className="field"><span>Estado</span><select value={status} onChange={event=>setStatus(event.target.value)}><option value="TODOS">Todos</option>{statuses.map(value=><option key={value} value={value}>{statusLabel(value)}</option>)}</select></label></div>
  <div className="live-reconciliation__layout"><div className="live-reconciliation__table-wrap"><table><thead><tr><th>SKU / producto</th><th>U.M.</th><th>Partida / serie</th><th>Vence</th><th>Disponible</th><th>Conteo</th><th>Diferencia</th><th>Estado</th></tr></thead><tbody>{workspace?.rows.length?workspace.rows.map(row=><tr key={`${row.codigo}:${row.reference_value??''}`} className={selected?.codigo===row.codigo&&selected.reference_value===row.reference_value?'is-selected':''} onClick={()=>setSelected(row)}><td><strong>{row.codigo}</strong><span>{row.descripcion}</span></td><td>{row.unit_code}</td><td>{reference(row)}</td><td>{row.expiration_date??'—'}</td><td>{number(row.available_quantity)}</td><td>{number(row.counted_quantity)}</td><td className={row.difference_quantity===0?'is-zero':row.difference_quantity>0?'is-positive':'is-negative'}>{row.difference_quantity>0?'+':''}{number(row.difference_quantity)}</td><td><span className={`live-status live-status--${row.status.toLowerCase()}`}>{statusLabel(row.status)}</span></td></tr>):<tr><td colSpan={8} className="live-reconciliation__empty">Aún no hay datos para este filtro.</td></tr>}</tbody></table></div>
   <aside className="live-reconciliation__detail" aria-live="polite"><h3>DETALLE DEL SKU</h3>{selected?<><strong>{selected.codigo}</strong><p>{selected.descripcion}</p><span className={`live-status live-status--${selected.status.toLowerCase()}`}>{statusLabel(selected.status)}</span><dl><div><dt>Disponible</dt><dd>{number(selected.available_quantity)}</dd></div><div><dt>Conteo físico</dt><dd>{number(selected.counted_quantity)}</dd></div><div><dt>Diferencia</dt><dd>{selected.difference_quantity>0?'+':''}{number(selected.difference_quantity)}</dd></div><div><dt>Referencia</dt><dd>{reference(selected)}</dd></div><div><dt>Vencimiento</dt><dd>{selected.expiration_date??'—'}</dd></div><div><dt>Último registro</dt><dd>{selected.last_received_at?new Date(selected.last_received_at).toLocaleString('es-CL'):'Sin conteo'}</dd></div></dl><p className="live-reconciliation__detail-note">Esta vista informa el estado físico; no envía ajustes a Softland ni cambia existencias.</p></>:<p>Selecciona una fila para revisar su detalle.</p>}</aside>
  </div>
 </section>
}

function Metric({label,value,detail,tone}:{label:string;value:string;detail:string;tone:'info'|'success'|'warning'|'error'|'neutral'}){return <article className={`live-metric live-metric--${tone}`}><span>{label}</span><strong>{value}</strong><small>{detail}</small></article>}
