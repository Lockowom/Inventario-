import type { SystemReferenceItem, SystemReferenceSourceFile } from '../domain/reconciliation/system-reference-contracts'
import { getSupabaseClient } from './supabase'

export type ReconciliationRow = {
 id:string; inventory_id:string; codigo:string; reference_type:'SERIAL'|'PARTIDA'|'LEGACY'; reference_value:string|null;
 anomaly_type:string; system_quantity:number; physical_quantity:number; status:string;
 confirmed_physical_quantity:number|null; disposition:string|null; resolution_reason:string|null;
}

async function rpc<T>(name:string,args:Record<string,unknown>):Promise<T>{
 const client=getSupabaseClient(); if(!client) throw new Error('Conciliación no configurada.'); const {data,error}=await client.rpc(name,args); if(error) throw new Error(error.message); return data as T
}
export type RecountMissionObservation={id:string;client_count_id:string;ubicacion:string;cantidad:number;captured_at:string}
export type RecountMission={
 id:string;case_id:string;inventory_id:string;round:2|3;status:'QUEUED'|'ACTIVE'|'COMPLETED'|'CANCELLED';
 codigo:string;descripcion:string;reference_type:'SERIAL'|'PARTIDA'|'LEGACY';reference_value:string|null;
 known_locations:string[];observations:RecountMissionObservation[];
}
export type RecountQueue={inventory_id:string;round:2|3|null;queued_count:number;active:RecountMission|null}
export type RecountMissionCompletion={mission_id:string;round:2|3;total_quantity:number;observation_count:number;case_id:string;case_status:string;confirmed_physical_quantity:number|null;next_round:3|null}
export type SystemReferenceImportResult={reference_version:number;row_count:number;fingerprint:string}
export type MissingBatchException={codigo:string;reason:string;created_at:string}
export type MaterializationResult={created_count:number;existing_count:number;source_fingerprint:string}
export type ReconciliationEvent={id:string;case_id:string;event_type:string;actor_user_id:string;actor_display_name:string;target_display_name:string|null;payload:Record<string,unknown>;created_at:string}
export type ReconciliationSummary={inventory_id:string;source_reference:null|{reference_version:number;row_count:number;fingerprint:string;source:string;import_identifier:string|null;imported_at:string};summary:{total:number;open:number;pending_analysis:number;second_recount:number;third_recount:number;physical_confirmed:number;resolved:number};anomalies:Record<string,number>;last_materialized_at:string|null}
export type LiveReconciliationStatus='CUADRADO'|'DIFERENCIA'|'NUEVO_LOTE_SERIE'|'FUERA_DE_DISPONIBLE'|'VENCIMIENTO_DISTINTO'
export type LiveReconciliationRow={codigo:string;descripcion:string;unit_code:string;reference_type:'SERIAL'|'PARTIDA'|'LEGACY';reference_value:string|null;expiration_date:string|null;available_quantity:number;counted_quantity:number;difference_quantity:number;status:LiveReconciliationStatus;last_received_at:string|null}
export type LiveReconciliationWorkspace={inventory_id:string;refreshed_at:string;metrics:{total_skus:number;counted_skus:number;matched_items:number;difference_items:number;new_references:number;non_available_items:number;available_units:number;counted_units:number;difference_units:number};rows:LiveReconciliationRow[]}
export class SupabaseReconciliationRepository {
 recountQueue(inventoryId:string){return rpc<RecountQueue>('get_my_recount_queue',{p_inventory_id:inventoryId})}
 claimNextMission(inventoryId:string){return rpc<RecountMission|null>('claim_next_recount_mission',{p_inventory_id:inventoryId})}
 addMissionObservation(missionId:string,clientCountId:string){return rpc<RecountMission>('add_my_recount_observation',{p_mission_id:missionId,p_client_count_id:clientCountId})}
 completeMission(missionId:string){return rpc<RecountMissionCompletion>('complete_my_recount_mission',{p_mission_id:missionId})}
 list(inventoryId:string){return rpc<ReconciliationRow[]>('list_reconciliation_cases',{p_inventory_id:inventoryId})}
 summary(inventoryId:string){return rpc<ReconciliationSummary>('get_reconciliation_summary',{p_inventory_id:inventoryId})}
 events(caseId:string){return rpc<ReconciliationEvent[]>('list_reconciliation_events',{p_case_id:caseId})}
 async importSystemReference(inventoryId:string,items:SystemReferenceItem[],fileName:string,fileSha256:string,sourceFiles:ReadonlyArray<SystemReferenceSourceFile>=[]){
  const source=sourceFiles.length===2
   ? `RP_XLSX:PARTIDAS=${sourceFiles.find(file=>file.role==='PARTIDAS')?.fileName??fileName}@${sourceFiles.find(file=>file.role==='PARTIDAS')?.sha256??''};SERIES=${sourceFiles.find(file=>file.role==='SERIES')?.fileName??fileName}@${sourceFiles.find(file=>file.role==='SERIES')?.sha256??''}`
   : `RP_XLSX:${fileName}`
  const rows=await rpc<SystemReferenceImportResult[]>('import_inventory_system_reference',{p_inventory_id:inventoryId,p_items:items.map(item=>({codigo:item.codigo,reference_value:item.referenceValue,quantity:item.quantity,available_quantity:item.availableQuantity,unit_code:item.unitCode,expiration_date:item.expirationDate})),p_source:source,p_import_identifier:fileSha256})
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
 liveWorkspace(inventoryId:string,search:string|null=null,status:string='TODOS'){return rpc<LiveReconciliationWorkspace>('get_live_reconciliation_workspace',{p_inventory_id:inventoryId,p_search:search,p_status:status,p_limit:100})}
 resolve(caseId:string,disposition:string,reason:string){return rpc<ReconciliationRow>('resolve_reconciliation',{p_case_id:caseId,p_disposition:disposition,p_reason:reason})}
}
