import { describe, expect, it, vi } from 'vitest'
import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import { ReconciliationScreen } from '../../src/features/reconciliation/reconciliation-screen'

const assignThird=vi.fn((caseId:string,userId:string)=>{void caseId;void userId;return Promise.resolve({})})
const candidates=vi.fn((caseId:string,round:number)=>{void caseId;void round;return Promise.resolve([{user_id:'analyst-2',display_name:'Analista Dos',role:'ANALISTA' as const}])})

vi.mock('../../src/services/supabase-supervision-repository',()=>({
 SupabaseSupervisionRepository:class{
  myProfile(){return Promise.resolve({role:'ADMIN'})}
  inventories(){return Promise.resolve([{id:'inv-1',name:'Synthetic',status:'ABIERTO'}])}
 }
}))

vi.mock('../../src/services/supabase-reconciliation-repository',()=>({
 SupabaseReconciliationRepository:class{
  list(){return Promise.resolve([{
   id:'case-3',inventory_id:'inv-1',codigo:'SKU003P',reference_type:'PARTIDA',reference_value:'LOT-3',
   anomaly_type:'DIFERENCIA_CANTIDAD_PARTIDA',system_quantity:5,physical_quantity:4,status:'REQUIERE_3ER_CONTEO',
   assigned_second_user_id:'counter-2',assigned_third_analyst_id:null,confirmed_physical_quantity:null,disposition:null,resolution_reason:null
  }])}
  summary(){return Promise.resolve({inventory_id:'inv-1',source_reference:null,summary:{total:1,open:1,pending_analysis:0,second_recount:0,third_recount:1,physical_confirmed:0,resolved:0},anomalies:{DIFERENCIA_CANTIDAD_PARTIDA:1},last_materialized_at:null})}
  candidates(caseId:string,round:number){return candidates(caseId,round)}
  assignThird(caseId:string,userId:string){return assignThird(caseId,userId)}
 }
}))

describe('F11 ADMIN third recount assignment surface',()=>{
 it('lets ADMIN assign C3 to an ANALISTA without exposing final analyst resolution',async()=>{
  render(<ReconciliationScreen/>)
  expect(await screen.findByText('SKU003P · LOT-3')).toBeTruthy()
  const select=screen.getByLabelText('Analista para 3.er conteo')
  fireEvent.focus(select)
  await waitFor(()=>expect(candidates).toHaveBeenCalledWith('case-3',3))
  expect(await screen.findByText('Analista Dos')).toBeTruthy()
  fireEvent.change(select,{target:{value:'analyst-2'}})
  fireEvent.click(screen.getByRole('button',{name:'ASIGNAR 3.er CONTEO'}))
  await waitFor(()=>expect(assignThird).toHaveBeenCalledWith('case-3','analyst-2'))
  expect(screen.queryByRole('button',{name:'REGISTRAR DICTAMEN Y CERRAR'})).toBeNull()
 })
})
