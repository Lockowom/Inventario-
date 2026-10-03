import * as XLSX from '@e965/xlsx'
import { describe, expect, it } from 'vitest'
import { parseSystemReferenceFiles, parseSystemReferenceXlsx } from '../../src/features/reconciliation/system-reference-import-parser'
import { hasBlockingSystemReferenceIssues } from '../../src/domain/reconciliation/system-reference-contracts'

function workbookBytes(options:{missingBatch?:boolean;duplicateSerial?:boolean;dropFromSerialUniverse?:boolean}={}){
 const total=[
  ['Cod. Producto','Producto','Cod. U. Medida','Disponible','Reserva','Transitoria','Consignación','Stock Total'],
  ['LEG001','Legacy','UNI',2,1,0,0,3],
  ['BAT001P','Batch','UNI',5,0,0,0,5],
  ['SER001S','Serial','UNI',2,0,0,0,2],
 ]
 const p=[
  ['Cod. Producto','Producto','Cod. U. Medida','Partida / Talla','Fecha Venc','Disponible','Reserva','Transitoria','Consignación','Stock Total'],
  ['LEG001','Legacy','UNI','', '',2,1,0,0,3],
  ['BAT001P','Batch','UNI',options.missingBatch?'':'LOT-01','',5,0,0,0,5],
  ['SER001S','Serial','UNI','', '',2,0,0,0,2],
 ]
 const s=[
  ['Cod. Producto','Producto','Cod. U. Medida','Serie','Disponible','Reserva','Transitoria','Consignación','Stock Total'],
  ['LEG001','Legacy','UNI','',2,1,0,0,3],
  ['BAT001P','Batch','UNI','',5,0,0,0,5],
  ['SER001S','Serial','UNI','SER-A',1,0,0,0,1],
  ['SER001S','Serial','UNI',options.duplicateSerial?'SER-A':'SER-B',1,0,0,0,1],
 ]
 if(options.dropFromSerialUniverse) s.splice(2,1)
 const workbook=XLSX.utils.book_new()
 XLSX.utils.book_append_sheet(workbook,XLSX.utils.aoa_to_sheet(total),'STOCK TOTAL')
 XLSX.utils.book_append_sheet(workbook,XLSX.utils.aoa_to_sheet(p),'STOCK CON P')
 XLSX.utils.book_append_sheet(workbook,XLSX.utils.aoa_to_sheet(s),'STOCK CON S')
 return XLSX.write(workbook,{bookType:'xlsx',type:'array'})
}

function fileFromWorkbook(rows:unknown[][],fileName:string){
 const workbook=XLSX.utils.book_new()
 XLSX.utils.book_append_sheet(workbook,XLSX.utils.aoa_to_sheet(rows),'Exportación Softland')
 const bytes=XLSX.write(workbook,{bookType:'xlsx',type:'array'}) as ArrayBuffer
 const file=new File([bytes],fileName,{type:'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet'})
 Object.defineProperty(file,'arrayBuffer',{value:()=>Promise.resolve(bytes)})
 return file
}

describe('F11 system reference RP parser',()=>{
 it('builds a valid SERIAL/PARTIDA/LEGACY snapshot from the canonical three sheets',async()=>{
  const preview=await parseSystemReferenceXlsx(workbookBytes(),'synthetic.xlsx')
  expect(hasBlockingSystemReferenceIssues(preview)).toBe(false)
  expect(preview.itemCount).toBe(4)
  expect(preview.legacyItems).toBe(1)
  expect(preview.batchItems).toBe(1)
  expect(preview.serialItems).toBe(2)
  expect(preview.items).toEqual(expect.arrayContaining([
   {codigo:'LEG001',referenceType:'LEGACY',referenceValue:null,quantity:3,availableQuantity:2,unitCode:'UNI',expirationDate:null},
   {codigo:'BAT001P',referenceType:'PARTIDA',referenceValue:'LOT-01',quantity:5,availableQuantity:5,unitCode:'UNI',expirationDate:null},
   {codigo:'SER001S',referenceType:'SERIAL',referenceValue:'SER-A',quantity:1,availableQuantity:1,unitCode:'UNI',expirationDate:null},
  ]))
  expect(preview.fileSha256).toMatch(/^[a-f0-9]{64}$/)
 })

 it('blocks a positive PARTIDA row without Partida / Talla',async()=>{
  const preview=await parseSystemReferenceXlsx(workbookBytes({missingBatch:true}),'synthetic.xlsx')
  expect(hasBlockingSystemReferenceIssues(preview)).toBe(true)
  expect(preview.issues.some(issue=>issue.message==='STOCK POSITIVO SIN PARTIDA / TALLA')).toBe(true)
 })

 it('blocks duplicate system serials',async()=>{
  const preview=await parseSystemReferenceXlsx(workbookBytes({duplicateSerial:true}),'synthetic.xlsx')
  expect(hasBlockingSystemReferenceIssues(preview)).toBe(true)
  expect(preview.issues.some(issue=>issue.message==='SERIE DUPLICADA EN FUENTE DE SISTEMA')).toBe(true)
 })

 it('blocks workbook sheet universes that do not reconcile',async()=>{
  const preview=await parseSystemReferenceXlsx(workbookBytes({dropFromSerialUniverse:true}),'synthetic.xlsx')
  expect(hasBlockingSystemReferenceIssues(preview)).toBe(true)
  expect(preview.issues.some(issue=>issue.message==='EL UNIVERSO SKU NO COINCIDE CON STOCK TOTAL')).toBe(true)
 })

 it('combina archivos separados de partidas y series sin requerir un libro consolidado',async()=>{
  const batches=fileFromWorkbook([
   ['Cod. Producto','Producto','Cod. U. Medida','Partida / Talla','Fecha Venc','Disponible','Reserva','Transitoria','Consignación','Stock Total'],
   ['LEG001','Legacy','UNI','', '',2,1,0,0,3],
   ['BAT001P','Batch','UNI','LOT-01','',5,0,0,0,5],
   ['SER001S','Serial','UNI','', '',2,0,0,0,2],
  ],'partidas.xlsx')
  const serials=fileFromWorkbook([
   ['Cod. Producto','Producto','Cod. U. Medida','Serie','Disponible','Reserva','Transitoria','Consignación','Stock Total'],
   ['LEG001','Legacy','UNI','',2,1,0,0,3],
   ['BAT001P','Batch','UNI','',5,0,0,0,5],
   ['SER001S','Serial','UNI','SER-A',1,0,0,0,1],
   ['SER001S','Serial','UNI','SER-B',1,0,0,0,1],
  ],'series.xlsx')
  const preview=await parseSystemReferenceFiles(batches,serials)

  expect(hasBlockingSystemReferenceIssues(preview)).toBe(false)
  expect(preview.sourceFiles).toEqual([
   expect.objectContaining({role:'PARTIDAS',fileName:'partidas.xlsx'}),
   expect.objectContaining({role:'SERIES',fileName:'series.xlsx'}),
  ])
  expect(preview.itemCount).toBe(4)
  expect(preview.items).toEqual(expect.arrayContaining([
   expect.objectContaining({codigo:'LEG001',referenceType:'LEGACY',availableQuantity:2}),
   expect.objectContaining({codigo:'BAT001P',referenceType:'PARTIDA',referenceValue:'LOT-01'}),
   expect.objectContaining({codigo:'SER001S',referenceType:'SERIAL',referenceValue:'SER-A'}),
  ]))
 })
})
