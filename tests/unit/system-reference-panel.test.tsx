import { describe, expect, it, vi } from 'vitest'
import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import { SystemReferencePanel } from '../../src/features/reconciliation/system-reference-panel'

const materialize=vi.fn((_inventoryId:string)=>Promise.resolve({created_count:2,existing_count:5,source_fingerprint:'abc'}))

vi.mock('../../src/services/supabase-reconciliation-repository',()=>({
 SupabaseReconciliationRepository:class{
  materialize(inventoryId:string){return materialize(inventoryId)}
  importSystemReference(){return Promise.resolve({reference_version:1,row_count:1,fingerprint:'a'.repeat(64)})}
 }
}))

describe('F11 system reference panel lifecycle',()=>{
 it('shows import controls only before inventory opening',()=>{
  render(<SystemReferencePanel inventoryId="inv-1" inventoryStatus="PREPARADO" onMaterialized={()=>undefined}/>)
  expect(screen.getByText('Libro RP (.xlsx)')).toBeTruthy()
  expect(screen.queryByRole('button',{name:'GENERAR / ACTUALIZAR HALLAZGOS'})).toBeNull()
 })

 it('shows materialization only for an open inventory',async()=>{
  const onMaterialized=vi.fn()
  render(<SystemReferencePanel inventoryId="inv-1" inventoryStatus="ABIERTO" onMaterialized={onMaterialized}/>)
  expect(screen.queryByText('Libro RP (.xlsx)')).toBeNull()
  fireEvent.click(screen.getByRole('button',{name:'GENERAR / ACTUALIZAR HALLAZGOS'}))
  await waitFor(()=>expect(materialize).toHaveBeenCalledWith('inv-1'))
  await waitFor(()=>expect(onMaterialized).toHaveBeenCalled())
  expect(screen.getByText(/2 casos nuevos, 5 casos abiertos/)).toBeTruthy()
 })
})
