import { describe, expect, it, vi } from 'vitest'
import { render, screen, waitFor } from '@testing-library/react'
import { ReconciliationTimeline } from '../../src/features/reconciliation/reconciliation-timeline'

const events=vi.fn((caseId:string)=>Promise.resolve([
 {id:'event-1',case_id:caseId,event_type:'SECOND_ASSIGNED',actor_user_id:'counter-uuid',actor_display_name:'Contador Dos',target_display_name:'Contador Dos',payload:{assigned_user_id:'counter-uuid'},created_at:'2026-10-01T10:00:00Z'},
 {id:'event-2',case_id:caseId,event_type:'SECOND_RECORDED',actor_user_id:'counter-uuid',actor_display_name:'Contador Dos',target_display_name:null,payload:{total_quantity:7,observation_count:2,result_status:'FISICO_CONFIRMADO'},created_at:'2026-10-01T10:05:00Z'},
 {id:'event-3',case_id:caseId,event_type:'RESOLVED',actor_user_id:'analyst-uuid',actor_display_name:'Analista Uno',target_display_name:null,payload:{disposition:'SIN_AJUSTE',reason:'Conteo confirmado'},created_at:'2026-10-01T10:10:00Z'},
]))

vi.mock('../../src/services/supabase-reconciliation-repository',()=>({
 SupabaseReconciliationRepository:class{events(caseId:string){return events(caseId)}}
}))

describe('F15 reconciliation timeline UI',()=>{
 it('loads the single mission ledger without a second disclosure layer or operational UUIDs',async()=>{
  render(<ReconciliationTimeline caseId="case-1"/>)
  await waitFor(()=>expect(events).toHaveBeenCalledWith('case-1'))
  expect(await screen.findByText('C2 iniciado')).toBeTruthy()
  expect(screen.getByText('Tomado por Contador Dos')).toBeTruthy()
  expect(screen.getByText('C2 finalizado')).toBeTruthy()
  expect(screen.getByText('Total físico: 7 · Ubicaciones: 2 · Resultado: FISICO CONFIRMADO')).toBeTruthy()
  expect(screen.getByText('Conciliación resuelta')).toBeTruthy()
  expect(screen.getByText('SIN AJUSTE · Conteo confirmado')).toBeTruthy()
  expect(screen.queryByRole('button',{name:/TRAZABILIDAD/})).toBeNull()
  expect(document.body.textContent).not.toContain('counter-uuid')
  expect(document.body.textContent).not.toContain('analyst-uuid')
 })
})
