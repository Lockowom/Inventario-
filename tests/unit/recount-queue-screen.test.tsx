import { render, screen } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'
import { RecountQueueScreen } from '../../src/features/reconciliation/recount-queue-screen'

vi.mock('../../src/services/supabase-supervision-repository',()=>({
 SupabaseSupervisionRepository:class{
  myProfile(){return Promise.resolve({user_id:'user-1',display_name:'Counter',role:'CONTADOR',active:true})}
  inventories(){return Promise.resolve([{id:'inv-1',name:'Inventory',status:'ABIERTO'}])}
 }
}))

vi.mock('../../src/services/supabase-reconciliation-repository',()=>({
 SupabaseReconciliationRepository:class{
  recountQueue(){return Promise.resolve({
   inventory_id:'inv-1',round:2,queued_count:3,
   active:{
    id:'mission-1',case_id:'case-1',inventory_id:'inv-1',round:2,status:'ACTIVE',
    codigo:'SKU001P',descripcion:'Producto prueba',reference_type:'PARTIDA',reference_value:'LOTE-01',
    known_locations:['A-21-03','B-02-01'],observations:[]
   }
  })}
 }
}))

vi.mock('../../src/domain/master/offline-master',()=>({
 isLocalMasterCurrent:()=>Promise.resolve(true),
 refreshMasterSnapshot:()=>Promise.resolve({}),
}))

vi.mock('../../src/features/counting/counting-runtime',()=>({
 getMasterSkuRepository:()=>({}),
 createCountingRuntime:()=>({}),
 createSyncCoordinator:()=>({}),
}))

describe('F15 recount queue',()=>{
 it('resolves its own open inventory and shows a blind multi-location mission',async()=>{
  render(<RecountQueueScreen/>)
  expect(await screen.findByText('C2 · SKU001P')).toBeTruthy()
  expect(screen.getByText('Inventory · Counter · CONTADOR')).toBeTruthy()
  expect(screen.getByText('A-21-03')).toBeTruthy()
  expect(screen.getByText('B-02-01')).toBeTruthy()
  expect(screen.getByText(/CONTEO CIEGO/)).toBeTruthy()
  expect(screen.queryByText(/Softland: 5/)).toBeNull()
  expect(screen.queryByText(/C1: 4/)).toBeNull()
  expect(screen.getByRole('button',{name:'CONFIRMAR 0 · NO ENCONTRADO'})).toBeEnabled()
  expect(screen.getByRole('button',{name:'FINALIZAR C2'})).toBeDisabled()
 })
})
