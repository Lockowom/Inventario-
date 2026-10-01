import { describe, expect, it } from 'vitest'
import { render, screen } from '@testing-library/react'
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
