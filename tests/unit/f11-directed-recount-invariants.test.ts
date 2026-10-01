import { describe, expect, it } from 'vitest'
import { createRecountCase, assignSecondCount, recordSecondCount, assignThirdCount, recordThirdCount } from '../../src/domain/reconciliation/recount-case'

const first={round:1 as const,userId:'u1',quantity:5,capturedAt:'2026-10-01T00:00:00Z'}
describe('F11 directed recount invariants',()=>{
 it('C2 equal C1 confirms physical quantity without a system adjustment decision',()=>{
  const assigned=assignSecondCount(createRecountCase({id:'r1',inventoryId:'i1',codigo:'0001',reference:null,firstCount:first}),'u2')
  const done=recordSecondCount(assigned,{round:2,userId:'u2',quantity:5,capturedAt:'2026-10-01T01:00:00Z'})
  expect(done.stage).toBe('RESUELTO'); expect(done.resolutionQuantity).toBe(5)
 })
 it('persistent discrepancy requires analyst C3 and preserves all observations',()=>{
  let item=assignSecondCount(createRecountCase({id:'r2',inventoryId:'i1',codigo:'0001',reference:'000003',firstCount:first}),'u2')
  item=recordSecondCount(item,{round:2,userId:'u2',quantity:4,capturedAt:'2026-10-01T01:00:00Z'})
  item=assignThirdCount(item,'analyst','ANALISTA')
  item=recordThirdCount(item,{round:3,userId:'analyst',quantity:4,capturedAt:'2026-10-01T02:00:00Z'},'ANALISTA')
  expect([item.firstCount.quantity,item.secondCount?.quantity,item.thirdCount?.quantity]).toEqual([5,4,4])
  expect(item.resolutionQuantity).toBe(4)
 })
})
