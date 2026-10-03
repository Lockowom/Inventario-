import { describe, expect, it } from 'vitest'
import { render, screen } from '@testing-library/react'
import { SystemReferencePanel } from '../../src/features/reconciliation/system-reference-panel'

const summary={
 inventory_id:'inv-1',
 source_reference:{reference_version:3,row_count:4650,fingerprint:'a'.repeat(64),source:'RP_XLSX:rp.xlsx',import_identifier:'hash',imported_at:'2026-10-03T00:00:00Z'},
 summary:{total:0,open:0,pending_analysis:0,second_recount:0,third_recount:0,physical_confirmed:0,resolved:0},
 anomalies:{},
 last_materialized_at:null,
}

describe('F16 RP status panel',()=>{
 it('is status-only and owns no upload or materialization action',()=>{
  render(<SystemReferencePanel inventoryStatus="ABIERTO" summary={summary}/>)
  expect(screen.getByText(/4650/)).toBeTruthy()
  expect(screen.getByText(/casos C2\/C3 definitivos se generan al finalizar C1/i)).toBeTruthy()
  expect(screen.queryByLabelText(/Libro RP/i)).toBeNull()
  expect(screen.queryByLabelText(/Archivo de partidas/i)).toBeNull()
  expect(screen.queryByLabelText(/Archivo de series/i)).toBeNull()
  expect(screen.queryByRole('button',{name:/HALLAZGOS/i})).toBeNull()
 })
})
