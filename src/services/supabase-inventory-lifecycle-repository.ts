import { getSupabaseClient } from './supabase'

export type InventoryLifecycle={
 inventory_id:string
 name:string
 inventory_status:'BORRADOR'|'PREPARADO'|'ABIERTO'|'CERRADO'|'CONGELADO'
 c1_status:'EN_CURSO'|'COMPLETADO'
 c1_completed_at:string|null
 c1_completed_by:string|null
 c1_count_records:number|null
 c1_counted_units:number|null
 c1_master_fingerprint:string|null
 c1_reference_fingerprint:string|null
 open_cases:number
 resolved_cases:number
 queued_missions:number
 active_missions:number
 can_finalize_c1:boolean
 can_close_inventory:boolean
 final_anomalies?:number
}

function clientOrThrow(){
 const client=getSupabaseClient()
 if(!client)throw new Error('Ciclo de inventario no configurado.')
 return client
}

export class SupabaseInventoryLifecycleRepository{
 async get(inventoryId:string){
  const {data,error}=await clientOrThrow().rpc('get_inventory_lifecycle',{p_inventory_id:inventoryId})
  if(error||!data)throw new Error(error?.message??'No fue posible cargar el ciclo del inventario.')
  return data as InventoryLifecycle
 }

 async finalizeC1(inventoryId:string){
  const {data,error}=await clientOrThrow().rpc('finalize_c1_coverage',{
   p_inventory_id:inventoryId,
   p_confirm_devices_synced:true,
  })
  if(error||!data)throw new Error(error?.message??'No fue posible finalizar C1.')
  return data as InventoryLifecycle
 }

 async close(inventoryId:string){
  const {data,error}=await clientOrThrow().rpc('close_inventory',{target_inventory_id:inventoryId})
  if(error||!data)throw new Error(error?.message??'No fue posible cerrar el inventario.')
  return data as {id:string;name:string;status:string}
 }
}
