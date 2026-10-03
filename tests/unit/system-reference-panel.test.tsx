import { describe, expect, it, vi } from 'vitest'
import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import { SystemReferencePanel } from '../../src/features/reconciliation/system-reference-panel'

const materialize=vi.fn((inventoryId:string)=>{void inventoryId;return Promise.resolve({created_count:2,existing_count:5,source_fingerprint:'abc'})})
const summary={
 inventory_id:'inv-1',
 source_reference:{reference_version:3,row_count:4650,fingerprint:'a'.repeat(64),source:'RP_XLSX:rp.xlsx',import_identifier:'hash',imported_at:'2026-10-03T00:00:00Z'},
 summary:{total:0,open:0,pending_analysis:0,second_recount:0,third_recount:0,physical_confirmed:0,resolved:0},
 anomalies:{},
 last_materialized_at:null,
}

vi.mock('../../src/services/supabase-reconciliation-repository',()=>({
 SupabaseReconciliationRepository:class{
  materialize(inventoryId:string){return materialize(inventoryId)}
 }
}))

describe('F15 RP status panel',()=>{
 it('removes every upload control from Conciliación',()=>{
  render(<SystemReferencePanel inventoryId="inv-1" inventoryStatus="PREPARADO" summary={summary} onMaterialized={()=>undefined}/>)
  expect(screen.getByText(/exclusivamente en/i)).toBeTruthy()
  expect(screen.queryByLabelText(/Libro RP/i)).toBeNull()
  expect(screen.queryByLabelText(/Archivo de partidas/i)).toBeNull()
  expect(screen.queryByLabelText(/Archivo de series/i)).toBeNull()
  expect(screen.queryByRole('button',{name:'GENERAR / ACTUALIZAR HALLAZGOS'})).toBeNull()
 })

 it('keeps materialization in Conciliación for an open inventory without refetching summary',async()=>{
  const onMaterialized=vi.fn()
  render(<SystemReferencePanel inventoryId="inv-1" inventoryStatus="ABIERTO" summary={summary} onMaterialized={onMaterialized}/>)
  expect(screen.getByText(/4650/)).toBeTruthy()
  fireEvent.click(screen.getByRole('button',{name:'GENERAR / ACTUALIZAR HALLAZGOS'}))
  await waitFor(()=>expect(materialize).toHaveBeenCalledWith('inv-1'))
  await waitFor(()=>expect(onMaterialized).toHaveBeenCalled())
  expect(screen.getByText(/2 casos nuevos, 5 casos abiertos/)).toBeTruthy()
 })
})
