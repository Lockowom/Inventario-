import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'
import { ReconciliationScreen } from '../../src/features/reconciliation/reconciliation-screen'

const completeFirstCount=vi.fn(()=>Promise.resolve({id:'inv-1',status:'C1_COMPLETADO',c1_completed_at:'2026-10-05T12:00:00Z',final_reconciliation_started_at:null}))
const startFinalReconciliation=vi.fn(()=>Promise.resolve({id:'inv-1',status:'CONCILIACION_FINAL',c1_completed_at:'2026-10-05T12:00:00Z',final_reconciliation_started_at:'2026-10-05T12:01:00Z'}))

vi.mock('../../src/services/supabase-supervision-repository',()=>({
 SupabaseSupervisionRepository:class{
  myProfile(){return Promise.resolve({role:'ADMIN'})}
  inventories(){return Promise.resolve([{id:'inv-1',name:'Inventario QA',status:'ABIERTO'}])}
 }
}))
vi.mock('../../src/services/supabase-reconciliation-repository',()=>({
 SupabaseReconciliationRepository:class{
  list(){return Promise.resolve([])}
  summary(){return Promise.resolve({inventory_id:'inv-1',source_reference:null,summary:{total:0,open:0,pending_analysis:0,second_recount:0,third_recount:0,physical_confirmed:0,resolved:0},anomalies:{},last_materialized_at:null})}
  liveWorkspace(){return Promise.resolve({inventory_id:'inv-1',refreshed_at:'2026-10-05T12:00:00Z',metrics:{total_skus:0,counted_skus:0,matched_items:0,difference_items:0,new_references:0,non_available_items:0,available_units:0,counted_units:0,difference_units:0},rows:[]})}
  completeFirstCount(inventoryId:string){expect(inventoryId).toBe('inv-1');return completeFirstCount()}
  startFinalReconciliation(inventoryId:string){expect(inventoryId).toBe('inv-1');return startFinalReconciliation()}
 }
}))

describe('F16 coverage gate',()=>{
 it('moves from C1 to final reconciliation only through explicit confirmations',async()=>{
  vi.spyOn(window,'confirm').mockReturnValue(true)
  render(<ReconciliationScreen/>)
  expect(await screen.findByRole('button',{name:'COMPLETAR C1'})).toBeTruthy()
  expect(screen.getByText(/aún no recorrida no se interpreta como faltante/i)).toBeTruthy()
  fireEvent.click(screen.getByRole('button',{name:'COMPLETAR C1'}))
  await waitFor(()=>expect(completeFirstCount).toHaveBeenCalledTimes(1))
  expect(await screen.findByRole('button',{name:'INICIAR CONCILIACIÓN FINAL'})).toBeTruthy()
  fireEvent.click(screen.getByRole('button',{name:'INICIAR CONCILIACIÓN FINAL'}))
  await waitFor(()=>expect(startFinalReconciliation).toHaveBeenCalledTimes(1))
  expect(await screen.findByText(/faltantes de referencia ya son casos investigables/i)).toBeTruthy()
 })
})
