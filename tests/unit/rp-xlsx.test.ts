import * as XLSX from '@e965/xlsx'
import { describe, expect, it } from 'vitest'
import { generateRpXlsx, RP_HEADERS, validateRpXlsx, type RpSnapshot } from '../../src/domain/cut/rp-xlsx'

const rows: RpSnapshot[] = [{ export_seq: 41, codigo: '000725', serie: '000SER', partida: '00725', pieza_producto: '0001', fecha_vencimiento: '2027-04-10', talla: 'M', color: 'NEGRO', cantidad_contada: 2, descripcion: 'Descripción snapshot' }, { export_seq: 42, codigo: '000001', cantidad_contada: 1, descripcion: 'Sin fecha' }]
describe('RP XLSX contract', () => {
  it('round-trips the one-sheet, nine-column immutable export contract', () => { const bytes=generateRpXlsx(rows); validateRpXlsx(bytes,rows); const wb=XLSX.read(bytes,{type:'array',cellDates:true}); expect(wb.SheetNames).toEqual(['INVENTARIO']); expect(XLSX.utils.sheet_to_json(wb.Sheets.INVENTARIO!,{header:1})[0]).toEqual(RP_HEADERS) })
  it('rejects non-contiguous snapshots and workbook corruption', () => { const first=rows[0]!; const second=rows[1]!; expect(()=>generateRpXlsx([{...first},{...second,export_seq:44}])).toThrow('contiguous'); const wb=XLSX.utils.book_new(); XLSX.utils.book_append_sheet(wb,XLSX.utils.aoa_to_sheet([['wrong']]),'OTHER'); expect(()=>validateRpXlsx(new Uint8Array(XLSX.write(wb,{bookType:'xlsx',type:'array'})),rows)).toThrow('exactly one') })
  it('rejects a valid-looking but incorrect expiration date and keeps null date blank', () => { const wb=XLSX.read(generateRpXlsx(rows),{type:'array',cellDates:true}); const sheet=wb.Sheets.INVENTARIO!; sheet.E2={ t:'d', v:new Date(2027,3,11), z:'dd-mm-yyyy' }; expect(()=>validateRpXlsx(new Uint8Array(XLSX.write(wb,{bookType:'xlsx',type:'array',cellDates:true})),rows)).toThrow('date mismatch'); const original=XLSX.read(generateRpXlsx(rows),{type:'array',cellDates:true}); expect(original.Sheets.INVENTARIO!.E3).toBeUndefined() })
})
