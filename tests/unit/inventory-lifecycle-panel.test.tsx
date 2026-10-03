import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'
import { InventoryLifecyclePanel } from '../../src/features/supervision/inventory-lifecycle-panel'

const get=vi.fn()
const finalizeC1=vi.fn()
const close=vi.fn()

vi.mock('../../src/services/supabase-inventory-lifecycle-repository',()=>({
 SupabaseInventoryLifecycleRepository:class{
  get(inventoryId:string){return get(inventoryId)}
  finalizeC1(inventoryId:string){return finalizeC1(inventoryId)}
  close(inventoryId:string){return close(inventoryId)}
 }
}))

const openState={
 inventory_id:'inv-1',name:'QA',inventory_status:'ABIERTO',c1_status:'EN_CURSO',
 c1_completed_at:null,c1_completed_by:null,c1_count_records:null,c1_counted_units:null,
 c1_master_fingerprint:null,c1_reference_fingerprint:null,
 open_cases:0,resolved_cases:0,queued_missions:0,active_missions:0,
 can_finalize_c1:true,can_close_inventory:false,
}

describe('F16 lifecycle panel',()=>{
 it('requires explicit device-sync confirmation before finalizing C1',async()=>{
  get.mockResolvedValue(openState)
  finalizeC1.mockResolvedValue({...openState,c1_status:'COMPLETADO',c1_completed_at:'2026-10-03T20:00:00Z',c1_completed_by:'user-1',c1_count_records:12,c1_counted_units:40,c1_master_fingerprint:'m',c1_reference_fingerprint:'r',open_cases:2,queued_missions:2,can_finalize_c1:false})
  vi.spyOn(window,'confirm').mockReturnValue(true)
  const onChanged=vi.fn()
  render(<InventoryLifecyclePanel inventoryId="inv-1" role="ADMIN" onChanged={onChanged}/>)
  const button=await screen.findByRole('button',{name:'FINALIZAR C1'})
  expect(button).toBeDisabled()
  fireEvent.click(screen.getByRole('checkbox'))
  expect(button).toBeEnabled()
  fireEvent.click(button)
  await waitFor(()=>expect(finalizeC1).toHaveBeenCalledWith('inv-1'))
  await waitFor(()=>expect(onChanged).toHaveBeenCalled())
  expect(await screen.findByText(/C1 finalizado/i)).toBeTruthy()
 })
})
