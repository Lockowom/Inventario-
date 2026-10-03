import { render, screen, waitFor } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'
import { MasterSkuScreen } from '../../src/features/master/master-sku-screen'
import { SystemReferencePanel } from '../../src/features/reconciliation/system-reference-panel'

vi.mock('../../src/services/supabase-supervision-repository',()=>({
 SupabaseSupervisionRepository:class{
  inventories(){return Promise.resolve([{id:'inv-1',name:'QA',status:'PREPARADO'}])}
 }
}))

vi.mock('../../src/services/supabase-master-sku-repository',()=>({
 SupabaseMasterSkuRepository:class{
  getMetadata(){return Promise.resolve({inventoryId:'inv-1',masterVersion:1,rowCount:10,fingerprint:'a'.repeat(64),cachedAt:'2026-10-03T00:00:00.000Z'})}
  addException(){return Promise.reject(new Error('not used'))}
 }
}))

vi.mock('../../src/services/supabase-reconciliation-repository',()=>({
 SupabaseReconciliationRepository:class{
  summary(){return Promise.resolve({
   inventory_id:'inv-1',
   source_reference:null,
   summary:{total:0,open:0,pending_analysis:0,second_recount:0,third_recount:0,physical_confirmed:0,resolved:0},
   anomalies:{},
   last_materialized_at:null,
  })}
 }
}))

vi.mock('../../src/features/counting/counting-runtime',()=>({getMasterSkuRepository:()=>({})}))

describe('F14 single upload ownership',()=>{
 it('Maestro SKU no longer exposes file or clipboard upload controls',async()=>{
  render(<MasterSkuScreen/>)
  await waitFor(()=>expect(screen.getByText(/Maestro activo v1/)).toBeInTheDocument())
  expect(screen.getByText(/exclusivamente en/i)).toHaveTextContent('Carga de datos')
  expect(screen.queryByLabelText(/Archivo maestro/i)).toBeNull()
  expect(screen.queryByText(/pegar desde Excel/i)).toBeNull()
 })

 it('Conciliación no longer exposes RP upload controls',async()=>{
  render(<SystemReferencePanel inventoryStatus="PREPARADO" summary={null}/>)
  await waitFor(()=>expect(screen.getByText(/No existe una referencia RP confirmada/)).toBeInTheDocument())
  expect(screen.queryByLabelText(/Libro RP/i)).toBeNull()
  expect(screen.queryByLabelText(/Archivo de partidas/i)).toBeNull()
  expect(screen.queryByLabelText(/Archivo de series/i)).toBeNull()
 })
})
