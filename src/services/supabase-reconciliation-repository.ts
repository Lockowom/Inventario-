import { getSupabaseClient } from './supabase'

export type ReconciliationRow = {
 id:string; inventory_id:string; codigo:string; reference_type:'SERIAL'|'PARTIDA'|'LEGACY'; reference_value:string|null;
 anomaly_type:string; system_quantity:number; physical_quantity:number; status:string; assigned_second_user_id:string|null;
 assigned_third_analyst_id:string|null; confirmed_physical_quantity:number|null; disposition:string|null; resolution_reason:string|null;
}

async function rpc<T>(name:string,args:Record<string,unknown>):Promise<T>{
 const client=getSupabaseClient(); if(!client) throw new Error('Conciliación no configurada.'); const {data,error}=await client.rpc(name,args); if(error) throw new Error(error.message); return data as T
}
export class SupabaseReconciliationRepository {
 list(inventoryId:string){return rpc<ReconciliationRow[]>('list_reconciliation_cases',{p_inventory_id:inventoryId})}
 assignSecond(caseId:string,userId:string){return rpc<ReconciliationRow>('assign_second_recount',{p_case_id:caseId,p_user_id:userId})}
 assignThird(caseId:string,userId:string){return rpc<ReconciliationRow>('assign_third_recount',{p_case_id:caseId,p_analyst_id:userId})}
 resolve(caseId:string,disposition:string,reason:string){return rpc<ReconciliationRow>('resolve_reconciliation',{p_case_id:caseId,p_disposition:disposition,p_reason:reason})}
}
