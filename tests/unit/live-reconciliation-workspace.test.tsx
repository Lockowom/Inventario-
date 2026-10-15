import { describe, expect, it, vi } from 'vitest'
import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import { LiveReconciliationWorkspace } from '../../src/features/reconciliation/live-reconciliation-workspace'

const liveWorkspace=vi.fn((inventoryId:string,search:string|null,status:string)=>{
 void inventoryId;void search;void status
 return Promise.resolve({
 inventory_id:'inv-available',refreshed_at:'2026-10-02T12:00:00Z',
 metrics:{total_skus:2,counted_skus:2,matched_items:1,difference_items:0,new_references:0,non_available_items:1,available_units:11,counted_units:27,difference_units:16},
 rows:[
  {codigo:'OPT54602150P',descripcion:'MUÑEQUERA AIR SPORT',unit_code:'UNI',reference_type:'PARTIDA',reference_value:'00622',expiration_date:null,available_quantity:11,counted_quantity:11,difference_quantity:0,status:'CUADRADO',last_received_at:'2026-10-02T12:00:00Z'},
  {codigo:'OPT54602150P',descripcion:'MUÑEQUERA AIR SPORT',unit_code:'UNI',reference_type:'PARTIDA',reference_value:'00824',expiration_date:null,available_quantity:0,counted_quantity:16,difference_quantity:16,status:'FUERA_DE_DISPONIBLE',last_received_at:'2026-10-02T12:01:00Z'},
 ],
 })
})

vi.mock('../../src/services/supabase-reconciliation-repository',()=>({
 SupabaseReconciliationRepository:class{liveWorkspace(inventoryId:string,search:string|null=null,status='TODOS'){return liveWorkspace(inventoryId,search,status)}},
}))

describe('F13 live reconciliation workspace',()=>{
 it('makes Disponible the explicit operational baseline and exposes lot-level status',async()=>{
  render(<LiveReconciliationWorkspace inventoryId="inv-available"/>)
  await waitFor(()=>expect(liveWorkspace).toHaveBeenCalledWith('inv-available',null,'TODOS'))
  expect(screen.getByText('LECTURA OPERATIVA · SOLO DISPONIBLE')).toBeTruthy()
  expect(screen.getByText(/Reserva, transitorio, consignación y Stock Total no se suman/)).toBeTruthy()
  expect(screen.getAllByText('OPT54602150P').length).toBeGreaterThan(0)
  expect(screen.getAllByText('00622').length).toBeGreaterThan(0)
  expect(screen.getAllByText('FUERA DE DISPONIBLE').length).toBeGreaterThan(0)
  fireEvent.click(screen.getByText('00824'))
  expect(screen.getByText('Esta vista informa el estado físico; no envía ajustes a Softland ni cambia existencias.')).toBeTruthy()
 })
})
