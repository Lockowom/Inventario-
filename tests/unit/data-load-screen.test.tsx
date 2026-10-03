import { render, screen, waitFor } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'
import { DataLoadScreen } from '../../src/features/data-load/data-load-screen'

const inventories=vi.fn(()=>Promise.resolve([{id:'11111111-1111-4111-8111-111111111111',name:'INVEN3 QA',status:'BORRADOR'}]))
const getMetadata=vi.fn(()=>Promise.resolve({
 inventoryId:'11111111-1111-4111-8111-111111111111',
 masterVersion:2,
 rowCount:7124,
 fingerprint:'a'.repeat(64),
 cachedAt:'2026-10-03T12:00:00.000Z',
}))
const listByInventory=vi.fn(()=>Promise.resolve([{inventoryId:'11111111-1111-4111-8111-111111111111',codigo:'SKU001',descripcion:'Producto',controlType:'LEGACY',cachedAt:'2026-10-03T12:00:00.000Z'}]))
const missingBatchExceptions=vi.fn(()=>Promise.resolve([]))
const summary=vi.fn(()=>Promise.resolve({
 inventory_id:'11111111-1111-4111-8111-111111111111',
 source_reference:null,
 summary:{total:0,open:0,pending_analysis:0,second_recount:0,third_recount:0,physical_confirmed:0,resolved:0},
 anomalies:{},
 last_materialized_at:null,
}))

vi.mock('../../src/services/supabase-supervision-repository',()=>({
 SupabaseSupervisionRepository:class{inventories(){return inventories()}}
}))
vi.mock('../../src/services/supabase-master-sku-repository',()=>({
 SupabaseMasterSkuRepository:class{
  getMetadata(){return getMetadata()}
  listByInventory(){return listByInventory()}
  importPreview(){return Promise.reject(new Error('not used'))}
 }
}))
vi.mock('../../src/services/supabase-reconciliation-repository',()=>({
 SupabaseReconciliationRepository:class{
  missingBatchExceptions(){return missingBatchExceptions()}
  summary(){return summary()}
  authorizeMissingBatchExceptions(){return Promise.reject(new Error('not used'))}
  importSystemReference(){return Promise.reject(new Error('not used'))}
 }
}))
vi.mock('../../src/features/counting/counting-runtime',()=>({getMasterSkuRepository:()=>({})}))

describe('F14 Data Load Center',()=>{
 it('centralizes Maestro and RP upload in one module',async()=>{
  render(<DataLoadScreen role="ADMIN"/>)
  await waitFor(()=>expect(screen.getByText(/Libro RP completo/)).toBeInTheDocument())
  expect(getMetadata).toHaveBeenCalled()
  expect(screen.getByRole('heading',{name:'CENTRO DE CARGA'})).toBeInTheDocument()
  expect(screen.getByText(/Archivo Maestro/)).toBeInTheDocument()
  expect(screen.queryByText(/Archivo de partidas/)).not.toBeInTheDocument()
  expect(screen.queryByText(/Archivo de series/)).not.toBeInTheDocument()
  expect(screen.getAllByText(/7124 SKU/).length).toBeGreaterThan(0)
 })

 it('explains that Conciliación and Maestro do not receive files anymore',async()=>{
  render(<DataLoadScreen role="ANALISTA"/>)
  await waitFor(()=>expect(screen.getByText(/Conciliación y Maestro ya no reciben archivos/i)).toBeInTheDocument())
 })
})
