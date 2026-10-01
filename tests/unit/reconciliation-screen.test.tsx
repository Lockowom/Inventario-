import { describe, expect, it, vi } from 'vitest'
import { render } from '@testing-library/react'
import { ReconciliationScreen } from '../../src/features/reconciliation/reconciliation-screen'

vi.mock('../../src/services/supabase-supervision-repository',()=>({SupabaseSupervisionRepository:class{myProfile(){return Promise.resolve({role:'CONTADOR'})} inventories(){return Promise.resolve([])}}}))
vi.mock('../../src/services/supabase-reconciliation-repository',()=>({SupabaseReconciliationRepository:class{list(){return Promise.resolve([])}}}))

describe('ReconciliationScreen authorization surface',()=>{
 it('does not expose analyst center to CONTADOR',async()=>{
  const {container}=render(<ReconciliationScreen/>)
  await new Promise(r=>setTimeout(r,0))
  expect(container.textContent).not.toContain('CENTRO DE CONCILIACIÓN')
 })
})


describe('F11 reconciliation decision vocabulary',()=>{
 it('keeps the counter surface blind to analyst resolution controls',async()=>{
  const {container}=render(<ReconciliationScreen/>); await new Promise(r=>setTimeout(r,0));
  expect(container.textContent).not.toContain('REGISTRAR DICTAMEN Y CERRAR')
  expect(container.textContent).not.toContain('AJUSTE PROPUESTO')
 })
})
