import { describe, expect, it, vi } from 'vitest'
import { fireEvent, render, screen } from '@testing-library/react'
import { ReconciliationScreen } from '../../src/features/reconciliation/reconciliation-screen'

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
   anomaly_type:'DIFERENCIA_CANTIDAD_SKU',system_quantity:5,physical_quantity:4,status:'REQUIERE_2DO_CONTEO',
confirmed_physical_quantity:null,disposition:null,resolution_reason:null
  }])}
  summary(){return Promise.resolve({
   inventory_id:'inv-1',source_reference:null,
   summary:{total:1,open:1,pending_analysis:0,second_recount:1,third_recount:0,physical_confirmed:0,resolved:0},
   anomalies:{DIFERENCIA_CANTIDAD_SKU:1},last_materialized_at:null
  })}
 }
}))

vi.mock('../../src/features/reconciliation/system-reference-panel',()=>({SystemReferencePanel:()=>null}))
vi.mock('../../src/features/reconciliation/live-reconciliation-workspace',()=>({LiveReconciliationWorkspace:()=>null}))
vi.mock('../../src/features/reconciliation/reconciliation-timeline',()=>({ReconciliationTimeline:()=>null}))

describe('F15 reconciliation mission UX',()=>{
 it('removes manual C2 assignment and keeps case details collapsed',async()=>{
  render(<ReconciliationScreen/>)
  expect(await screen.findByText('CENTRO DE CONCILIACIÓN')).toBeTruthy()
  expect(await screen.findByText('SKU001')).toBeTruthy()
  expect(screen.queryByLabelText('Contador para 2.º conteo')).toBeNull()
  expect(screen.queryByRole('button',{name:'ASIGNAR 2.º CONTEO'})).toBeNull()
  expect(screen.getByText(/misión C2 automáticamente/i)).toBeTruthy()

  fireEvent.click(screen.getByRole('button',{name:/SKU001/i}))
  expect(await screen.findByText('C1 físico total')).toBeTruthy()
  expect(screen.getByText(/Las cantidades por ubicación no se comparan contra Softland/i)).toBeTruthy()
 })
})
