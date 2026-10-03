import type { SystemReferenceItem } from '../domain/reconciliation/system-reference-contracts'
import { getSupabaseClient } from './supabase'

export type ReconciliationRow = {
 id:string; inventory_id:string; codigo:string; reference_type:'SERIAL'|'PARTIDA'|'LEGACY'; reference_value:string|null;
 anomaly_type:string; system_quantity:number; physical_quantity:number; status:string; assigned_second_user_id:string|null;
 assigned_third_analyst_id:string|null; confirmed_physical_quantity:number|null; disposition:string|null; resolution_reason:string|null;
}

async function rpc<T>(name:string,args:Record<string,unknown>):Promise<T>{
 const client=getSupabaseClient(); if(!client) throw new Error('Conciliación no configurada.'); const {data,error}=await client.rpc(name,args); if(error) throw new Error(error.message); return data as T
}
export type RecountAssignment={id:string;inventory_id:string;codigo:string;reference_type:'SERIAL'|'PARTIDA'|'LEGACY';reference_value:string|null;round:2|3}
export type RecountCandidate={user_id:string;display_name:string;role:'CONTADOR'|'ANALISTA'}
export type SystemReferenceImportResult={reference_version:number;row_count:number;fingerprint:string}
export type MissingBatchException={codigo:string;reason:string;created_at:string}
export type MaterializationResult={created_count:number;existing_count:number;source_fingerprint:string}
export type ReconciliationEvent={id:string;case_id:string;event_type:string;actor_user_id:string;actor_display_name:string;target_display_name:string|null;payload:Record<string,unknown>;created_at:string}
export type ReconciliationSummary={inventory_id:string;source_reference:null|{reference_version:number;row_count:number;fingerprint:string;source:string;import_identifier:string|null;imported_at:string};summary:{total:number;open:number;pending_analysis:number;second_recount:number;third_recount:number;physical_confirmed:number;resolved:number};anomalies:Record<string,number>;last_materialized_at:string|null}
export class SupabaseReconciliationRepository {
 myAssignments(inventoryId:string){return rpc<RecountAssignment[]>('get_my_recount_assignments',{p_inventory_id:inventoryId})}
 recordMyRecount(caseId:string,clientCountId:string){return rpc<ReconciliationRow>('record_my_recount',{p_case_id:caseId,p_client_count_id:clientCountId})}
 list(inventoryId:string){return rpc<ReconciliationRow[]>('list_reconciliation_cases',{p_inventory_id:inventoryId})}
 summary(inventoryId:string){return rpc<ReconciliationSummary>('get_reconciliation_summary',{p_inventory_id:inventoryId})}
 events(caseId:string){return rpc<ReconciliationEvent[]>('list_reconciliation_events',{p_case_id:caseId})}
 candidates(caseId:string,round:2|3){return rpc<RecountCandidate[]>('list_recount_candidates',{p_case_id:caseId,p_round:round})}
 async importSystemReference(inventoryId:string,items:SystemReferenceItem[],fileName:string,fileSha256:string){
  const rows=await rpc<SystemReferenceImportResult[]>('import_inventory_system_reference',{p_inventory_id:inventoryId,p_items:items.map(item=>({codigo:item.codigo,reference_value:item.referenceValue,quantity:item.quantity})),p_source:`RP_XLSX:${fileName}`,p_import_identifier:fileSha256})
  const result=rows[0];if(!result)throw new Error('La referencia de sistema no devolvió metadata.');return result
 }
 async missingBatchExceptions(inventoryId:string):Promise<MissingBatchException[]>{
  const client=getSupabaseClient();if(!client)throw new Error('Conciliación no configurada.')
  const {data,error}=await client.from('inventory_missing_batch_exceptions').select('codigo,reason,created_at').eq('inventory_id',inventoryId).eq('active',true).order('codigo')
  if(error)throw new Error(error.message)
  return (data??[]) as MissingBatchException[]
 }
 authorizeMissingBatchExceptions(inventoryId:string,codes:string[],reason:string){
  return rpc<Array<{codigo:string;reason:string;placeholder:string}>>('authorize_missing_batch_exceptions',{p_inventory_id:inventoryId,p_codes:codes,p_reason:reason})
 }
 async materialize(inventoryId:string){
  const rows=await rpc<MaterializationResult[]>('materialize_reconciliation_cases',{p_inventory_id:inventoryId})
  const result=rows[0];if(!result)throw new Error('La materialización no devolvió resultado.');return result
 }
 assignSecond(caseId:string,userId:string){return rpc<ReconciliationRow>('assign_second_recount',{p_case_id:caseId,p_user_id:userId})}
 assignThird(caseId:string,userId:string){return rpc<ReconciliationRow>('assign_third_recount',{p_case_id:caseId,p_analyst_id:userId})}
 resolve(caseId:string,disposition:string,reason:string){return rpc<ReconciliationRow>('resolve_reconciliation',{p_case_id:caseId,p_disposition:disposition,p_reason:reason})}
}
