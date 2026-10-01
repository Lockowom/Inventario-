import { describe, expect, it, vi } from 'vitest'
import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import { ReconciliationScreen } from '../../src/features/reconciliation/reconciliation-screen'

const assignSecond=vi.fn(()=>Promise.resolve({}))
const candidates=vi.fn(()=>Promise.resolve([{user_id:'counter-2',display_name:'Counter Two',role:'CONTADOR'}]))

vi.mock('../../src/services/supabase-supervision-repository',()=>({
 SupabaseSupervisionRepository:class{
  myProfile(){return Promise.resolve({role:'ANALISTA'})}
  inventories(){return Promise.resolve([{id:'inv-1',name:'Synthetic',status:'ABIERTO'}])}
 }
}))

vi.mock('../../src/services/supabase-reconciliation-repository',()=>({
 SupabaseReconciliationRepository:class{
  list(){return Promise.resolve([{
   id:'case-1',inventory_id:'inv-1',codigo:'SKU001',reference_type:'LEGACY',reference_value:null,
   anomaly_type:'DIFERENCIA_CANTIDAD_SKU',system_quantity:5,physical_quantity:4,status:'PENDIENTE_ANALISIS',
   assigned_second_user_id:null,assigned_third_analyst_id:null,confirmed_physical_quantity:null,disposition:null,resolution_reason:null
  }])}
  candidates(caseId:string,round:number){return candidates(caseId,round)}
  assignSecond(caseId:string,userId:string){return assignSecond(caseId,userId)}
 }
}))

describe('F11 reconciliation assignment UI',()=>{
 it('uses eligible named candidates instead of raw UUID entry',async()=>{
  render(<ReconciliationScreen/>)
  expect(await screen.findByText('CENTRO DE CONCILIACIÓN')).toBeTruthy()
  expect(screen.queryByText(/UUID contador/i)).toBeNull()
  const select=screen.getByLabelText('Contador para 2.º conteo')
  fireEvent.focus(select)
  await waitFor(()=>expect(candidates).toHaveBeenCalledWith('case-1',2))
  expect(await screen.findByText('Counter Two')).toBeTruthy()
  fireEvent.change(select,{target:{value:'counter-2'}})
  fireEvent.click(screen.getByRole('button',{name:'ASIGNAR 2.º CONTEO'}))
  await waitFor(()=>expect(assignSecond).toHaveBeenCalledWith('case-1','counter-2'))
 })
})
