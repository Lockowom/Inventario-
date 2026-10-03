import { describe, expect, it, vi } from 'vitest'
import { fireEvent, render, screen } from '@testing-library/react'
import { ReconciliationScreen } from '../../src/features/reconciliation/reconciliation-screen'

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
confirmed_physical_quantity:null,disposition:null,resolution_reason:null
  }])}
  summary(){return Promise.resolve({
   inventory_id:'inv-1',source_reference:null,
   summary:{total:1,open:1,pending_analysis:0,second_recount:0,third_recount:1,physical_confirmed:0,resolved:0},
   anomalies:{DIFERENCIA_CANTIDAD_PARTIDA:1},last_materialized_at:null
  })}
 }
}))

vi.mock('../../src/features/reconciliation/system-reference-panel',()=>({SystemReferencePanel:()=>null}))
vi.mock('../../src/features/reconciliation/live-reconciliation-workspace',()=>({LiveReconciliationWorkspace:()=>null}))
vi.mock('../../src/features/reconciliation/reconciliation-timeline',()=>({ReconciliationTimeline:()=>null}))

describe('F15 C3 mission surface',()=>{
 it('removes manual C3 assignment from Conciliación and keeps the case compact',async()=>{
  render(<ReconciliationScreen/>)
  expect(await screen.findByText('SKU003P')).toBeTruthy()
  expect(screen.getByText('LOT-3')).toBeTruthy()
  expect(screen.getByText('REQUIERE 3ER CONTEO')).toBeTruthy()
  expect(screen.queryByLabelText('Analista para 3.er conteo')).toBeNull()
  expect(screen.queryByRole('button',{name:'ASIGNAR 3.er CONTEO'})).toBeNull()

  fireEvent.click(screen.getByRole('button',{name:/SKU003P/i}))
  expect(screen.getByText('C1 físico total')).toBeTruthy()
  expect(screen.queryByRole('button',{name:/REGISTRAR DICTAMEN/})).toBeNull()
 })
})
