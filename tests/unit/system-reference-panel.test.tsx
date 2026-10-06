import { describe, expect, it, vi } from 'vitest'
import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import { SystemReferencePanel } from '../../src/features/reconciliation/system-reference-panel'

const materialize=vi.fn((inventoryId:string)=>{void inventoryId;return Promise.resolve({created_count:2,existing_count:5,source_fingerprint:'abc'})})

vi.mock('../../src/services/supabase-reconciliation-repository',()=>({
 SupabaseReconciliationRepository:class{
  materialize(inventoryId:string){return materialize(inventoryId)}
  importSystemReference(){return Promise.resolve({reference_version:1,row_count:1,fingerprint:'a'.repeat(64)})}
  missingBatchExceptions(){return Promise.resolve([])}
 }
}))

describe('F11 system reference panel lifecycle',()=>{
 it('shows import controls only before inventory opening',()=>{
  render(<SystemReferencePanel inventoryId="inv-1" inventoryStatus="PREPARADO" role="ADMIN" onMaterialized={()=>undefined}/>)
  expect(screen.getByText('Archivo de partidas (.xlsx)')).toBeTruthy()
  expect(screen.getByText('Archivo de series (.xlsx)')).toBeTruthy()
  expect(screen.queryByRole('button',{name:'GENERAR / ACTUALIZAR HALLAZGOS'})).toBeNull()
 })

 it('updates live differences while C1 keeps uncounted system references informational',async()=>{
  const onMaterialized=vi.fn()
  render(<SystemReferencePanel inventoryId="inv-1" inventoryStatus="ABIERTO" role="ADMIN" onMaterialized={onMaterialized}/>)
  expect(screen.queryByText('Libro RP (.xlsx)')).toBeNull()
  expect(screen.getByText(/aún no contadas no se interpretan como faltantes/i)).toBeTruthy()
  fireEvent.click(screen.getByRole('button',{name:'ACTUALIZAR DIFERENCIAS EN VIVO'}))
  await waitFor(()=>expect(materialize).toHaveBeenCalledWith('inv-1'))
  await waitFor(()=>expect(onMaterialized).toHaveBeenCalled())
 })

 it('enables missing-case materialization only in final reconciliation',async()=>{
  const onMaterialized=vi.fn()
  render(<SystemReferencePanel inventoryId="inv-1" inventoryStatus="CONCILIACION_FINAL" role="ADMIN" onMaterialized={onMaterialized}/>)
  fireEvent.click(screen.getByRole('button',{name:'GENERAR / ACTUALIZAR HALLAZGOS FINALES'}))
  await waitFor(()=>expect(materialize).toHaveBeenCalledWith('inv-1'))
  await waitFor(()=>expect(onMaterialized).toHaveBeenCalled())
  expect(screen.getByText(/2 casos nuevos, 5 casos abiertos/)).toBeTruthy()
 })
})
