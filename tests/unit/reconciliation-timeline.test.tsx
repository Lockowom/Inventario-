import { describe, expect, it, vi } from 'vitest'
import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import { ReconciliationTimeline } from '../../src/features/reconciliation/reconciliation-timeline'

const events=vi.fn((caseId:string)=>Promise.resolve([
 {id:'event-1',case_id:caseId,event_type:'SECOND_ASSIGNED',actor_user_id:'actor-uuid',actor_display_name:'Analista Uno',target_display_name:'Contador Dos',payload:{assigned_user_id:'counter-uuid'},created_at:'2026-10-01T10:00:00Z'},
 {id:'event-2',case_id:caseId,event_type:'RESOLVED',actor_user_id:'actor-uuid',actor_display_name:'Analista Uno',target_display_name:null,payload:{disposition:'SIN_AJUSTE',reason:'Conteo confirmado'},created_at:'2026-10-01T10:10:00Z'},
]))

vi.mock('../../src/services/supabase-reconciliation-repository',()=>({
 SupabaseReconciliationRepository:class{events(caseId:string){return events(caseId)}}
}))

describe('F11 reconciliation timeline UI',()=>{
 it('loads names and lifecycle details without exposing operational UUIDs',async()=>{
  render(<ReconciliationTimeline caseId="case-1"/>)
  fireEvent.click(screen.getByRole('button',{name:'VER TRAZABILIDAD'}))
  await waitFor(()=>expect(events).toHaveBeenCalledWith('case-1'))
  expect(await screen.findByText('2.º conteo asignado')).toBeTruthy()
  expect(screen.getByText(/Analista Uno/)).toBeTruthy()
  expect(screen.getByText('Asignado a Contador Dos')).toBeTruthy()
  expect(screen.getByText('Conciliación resuelta')).toBeTruthy()
  expect(screen.getByText('SIN AJUSTE · Conteo confirmado')).toBeTruthy()
  expect(document.body.textContent).not.toContain('actor-uuid')
  expect(document.body.textContent).not.toContain('counter-uuid')
 })
})
