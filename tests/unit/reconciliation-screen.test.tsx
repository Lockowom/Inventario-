import { describe, expect, it, vi } from 'vitest'
import { render, waitFor } from '@testing-library/react'
import { ReconciliationScreen } from '../../src/features/reconciliation/reconciliation-screen'

const myProfile=vi.fn(()=>Promise.resolve({role:'CONTADOR'}))
const inventories=vi.fn(()=>Promise.resolve([]))
vi.mock('../../src/services/supabase-supervision-repository',()=>({SupabaseSupervisionRepository:class{myProfile(){return myProfile()} inventories(){return inventories()}}}))
vi.mock('../../src/services/supabase-reconciliation-repository',()=>({SupabaseReconciliationRepository:class{list(){return Promise.resolve([])}}}))

describe('ReconciliationScreen authorization surface',()=>{
 it('does not expose analyst center to CONTADOR',async()=>{
  const {container}=render(<ReconciliationScreen/>)
  await waitFor(()=>expect(myProfile).toHaveBeenCalledTimes(1))
  await waitFor(()=>expect(inventories).toHaveBeenCalledTimes(1))
  expect(container.textContent).not.toContain('CENTRO DE CONCILIACIÓN')
 })
})


describe('F15 reconciliation decision vocabulary',()=>{
 it('keeps the counter surface blind to analyst resolution controls',async()=>{
  const {container}=render(<ReconciliationScreen/>); await waitFor(()=>expect(myProfile).toHaveBeenCalledTimes(2)); await waitFor(()=>expect(inventories).toHaveBeenCalledTimes(2));
  expect(container.textContent).not.toContain('REGISTRAR DICTAMEN Y CERRAR')
  expect(container.textContent).not.toContain('AJUSTE PROPUESTO')
 })
})
