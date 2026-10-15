import { useCallback, useEffect, useState } from 'react'
import { SupabaseInventoryLifecycleRepository, type InventoryLifecycle } from '../../services/supabase-inventory-lifecycle-repository'

const repository=new SupabaseInventoryLifecycleRepository()

export function InventoryLifecyclePanel({
 inventoryId,
 role,
 onChanged,
}:{
 inventoryId:string
 role:'ANALISTA'|'ADMIN'
 onChanged:()=>Promise<void>|void
}){
 const [state,setState]=useState<InventoryLifecycle|null>(null)
 const [confirmed,setConfirmed]=useState(false)
 const [busy,setBusy]=useState(false)
 const [message,setMessage]=useState('')

 const refresh=useCallback(async()=>{
  if(!inventoryId)return
  try{
   const next=await repository.get(inventoryId)
   setState(next)
  }catch(error){
   setState(null)
   setMessage(error instanceof Error?error.message:'No fue posible cargar el ciclo del inventario.')
  }
 },[inventoryId])

 useEffect(()=>{setConfirmed(false);setMessage('');void refresh()},[refresh])

 async function finalizeC1(){
  if(!confirmed||!state?.can_finalize_c1)return
  if(!window.confirm('Finalizar C1 bloqueará nuevos conteos normales. Confirma sólo si todos los dispositivos terminaron y sincronizaron.'))return
  try{
   setBusy(true);setMessage('')
   const next=await repository.finalizeC1(inventoryId)
   setState(next);setConfirmed(false)
   await onChanged()
   setMessage('C1 finalizado. La conciliación final fue materializada y las discrepancias quedaron en cola C2.')
  }catch(error){setMessage(error instanceof Error?error.message:'No fue posible finalizar C1.')}
  finally{setBusy(false)}
 }

 async function closeInventory(){
  if(!state?.can_close_inventory)return
  if(!window.confirm('Cerrar el inventario es el cierre operativo final. Confirma que todos los casos de conciliación fueron resueltos.'))return
  try{
   setBusy(true);setMessage('')
   await repository.close(inventoryId)
   await refresh()
   await onChanged()
   setMessage('Inventario cerrado correctamente.')
  }catch(error){setMessage(error instanceof Error?error.message:'No fue posible cerrar el inventario.')}
  finally{setBusy(false)}
 }

 if(!state)return <section className="inventory-lifecycle"><h2>FASE DEL INVENTARIO</h2><p>{message||'Cargando ciclo operativo…'}</p></section>

 return <section className="inventory-lifecycle" aria-labelledby="inventory-lifecycle-title">
  <div className="inventory-lifecycle__header">
   <div><p className="eyebrow">F16 · cobertura y cierre</p><h2 id="inventory-lifecycle-title">FASE DEL INVENTARIO</h2></div>
   <strong>{state.inventory_status}</strong>
  </div>

  <div className="inventory-lifecycle__steps">
   <article className={state.c1_status==='COMPLETADO'?'is-complete':'is-active'}>
    <span>1</span><div><strong>C1 · Conteo físico</strong><small>{state.c1_status==='COMPLETADO'?'COMPLETADO':'EN CURSO'}</small></div>
   </article>
   <article className={state.c1_status==='COMPLETADO'&&state.open_cases>0?'is-active':state.c1_status==='COMPLETADO'?'is-complete':''}>
    <span>2</span><div><strong>Conciliación</strong><small>{state.c1_status!=='COMPLETADO'?'PENDIENTE':state.open_cases>0?state.open_cases+' CASOS ABIERTOS':'COMPLETADA'}</small></div>
   </article>
   <article className={state.inventory_status==='CERRADO'?'is-complete':state.can_close_inventory?'is-active':''}>
    <span>3</span><div><strong>Cierre</strong><small>{state.inventory_status==='CERRADO'?'CERRADO':state.can_close_inventory?'LISTO PARA CERRAR':'PENDIENTE'}</small></div>
   </article>
  </div>

  {state.c1_status==='EN_CURSO'&&<>
   <p className="inventory-lifecycle__warning">C1 permanece abierto. Las diferencias visibles son informativas; todavía no deben convertirse en C2 porque un mismo SKU/lote puede aparecer en varias ubicaciones.</p>
   <label className="inventory-lifecycle__confirm">
    <input type="checkbox" checked={confirmed} disabled={busy} onChange={event=>setConfirmed(event.target.checked)}/>
    <span>Confirmo que todos los dispositivos terminaron el C1 y sincronizaron sus conteos pendientes.</span>
   </label>
   <button className="button-primary" type="button" disabled={busy||!confirmed||!state.can_finalize_c1} onClick={()=>void finalizeC1()}>{busy?'PROCESANDO…':'FINALIZAR C1'}</button>
  </>}

  {state.c1_status==='COMPLETADO'&&<div className="inventory-lifecycle__metrics">
   <div><span>Conteos C1</span><strong>{state.c1_count_records??0}</strong></div>
   <div><span>Unidades C1</span><strong>{state.c1_counted_units??0}</strong></div>
   <div><span>Casos abiertos</span><strong>{state.open_cases}</strong></div>
   <div><span>Misiones en cola</span><strong>{state.queued_missions}</strong></div>
   <div><span>Misiones activas</span><strong>{state.active_missions}</strong></div>
   <div><span>Casos resueltos</span><strong>{state.resolved_cases}</strong></div>
  </div>}

  {state.c1_status==='COMPLETADO'&&state.open_cases>0&&<p className="inventory-lifecycle__note">Continúa por <strong>Reconteos</strong> para C2/C3 y por <strong>Conciliación</strong> para el dictamen final. No se permiten nuevos C1.</p>}

  {state.can_close_inventory&&<button className="button-primary" type="button" disabled={busy} onClick={()=>void closeInventory()}>{busy?'CERRANDO…':'CERRAR INVENTARIO'}</button>}
  {state.inventory_status==='CERRADO'&&<p className="inventory-lifecycle__closed">Inventario cerrado. El snapshot físico y la conciliación quedaron finalizados.</p>}

  <p className="inventory-lifecycle__actor">Control disponible para {role}.</p>
  {message&&<p className="master-message" role="status">{message}</p>}
 </section>
}
