import * as XLSX from '@e965/xlsx'
import { describe, expect, it } from 'vitest'
import { generateRpXlsx, RP_HEADERS, validateRpXlsx, type RpSnapshot } from '../../src/domain/cut/rp-xlsx'
import { excelSerial, isoDateUtc, rpRow } from '../../supabase/functions/_shared/rp-contract'

const rows: RpSnapshot[] = [{ export_seq: 41, codigo: '000725', serie: '000SER', partida: '00725', pieza_producto: '0001', fecha_vencimiento: '2027-04-10', talla: 'M', color: 'NEGRO', cantidad_contada: 2, descripcion: 'Descripción snapshot' }, { export_seq: 42, codigo: '000001', cantidad_contada: 1, descripcion: 'Sin fecha' }]
describe('RP XLSX contract', () => {
  it('round-trips the one-sheet, nine-column immutable export contract', () => { const bytes=generateRpXlsx(rows); validateRpXlsx(bytes,rows); const wb=XLSX.read(bytes,{type:'array',cellDates:true}); expect(wb.SheetNames).toEqual(['INVENTARIO']); expect(XLSX.utils.sheet_to_json(wb.Sheets.INVENTARIO!,{header:1})[0]).toEqual(RP_HEADERS) })
  it('rejects non-contiguous snapshots and workbook corruption', () => { const first=rows[0]!; const second=rows[1]!; expect(()=>generateRpXlsx([{...first},{...second,export_seq:44}])).toThrow('contiguous'); const wb=XLSX.utils.book_new(); XLSX.utils.book_append_sheet(wb,XLSX.utils.aoa_to_sheet([['wrong']]),'OTHER'); expect(()=>validateRpXlsx(new Uint8Array(XLSX.write(wb,{bookType:'xlsx',type:'array'})),rows)).toThrow('exactly one') })
  it('rejects a valid-looking but incorrect expiration date and keeps null date blank', () => { const wb=XLSX.read(generateRpXlsx(rows),{type:'array',cellDates:true}); const sheet=wb.Sheets.INVENTARIO!; sheet.E2={ t:'d', v:new Date(2027,3,11), z:'dd-mm-yyyy' }; expect(()=>validateRpXlsx(new Uint8Array(XLSX.write(wb,{bookType:'xlsx',type:'array',cellDates:true})),rows)).toThrow('date mismatch'); const original=XLSX.read(generateRpXlsx(rows),{type:'array',cellDates:true}); expect(original.Sheets.INVENTARIO!.E3).toBeUndefined() })
  it('uses UTC serialisation for dates independently of runtime timezone', () => { expect(excelSerial('2027-05-15')).toBe(46522); expect(isoDateUtc(rpRow({ ...rows[0]!, fecha_vencimiento: '2027-05-15' })[4])).toBe('2027-05-15') })
  it('rejects every independent contract corruption before READY can be reached', () => {
    const corrupt = (change: (workbook: XLSX.WorkBook, sheet: XLSX.WorkSheet) => void) => {
      const workbook = XLSX.read(generateRpXlsx(rows), { type: 'array', cellDates: true }); const sheet = workbook.Sheets.INVENTARIO!
      change(workbook, sheet)
      return new Uint8Array(XLSX.write(workbook, { bookType: 'xlsx', type: 'array', cellDates: true }))
    }
    const cases: Array<[string, (workbook: XLSX.WorkBook, sheet: XLSX.WorkSheet) => void]> = [
      ['header', (_, s) => { s.A1 = { t: 's', v: 'CODIGO ALTERADO' } }],
      ['worksheet name', (w) => { w.SheetNames[0] = 'OTRA'; w.Sheets.OTRA = w.Sheets.INVENTARIO!; delete w.Sheets.INVENTARIO }],
      ['additional worksheet', (w) => { XLSX.utils.book_append_sheet(w, XLSX.utils.aoa_to_sheet([['x']]), 'EXTRA') }],
      ['additional column', (_, s) => { s.J2 = { t: 's', v: 'extra' }; s['!ref'] = 'A1:J3' }],
      ['additional row', (_, s) => { s.A4 = { t: 's', v: 'extra' }; s['!ref'] = 'A1:I4' }],
      ['missing row', (_, s) => { s['!ref'] = 'A1:I2' }],
      ['codigo', (_, s) => { s.A2 = { t: 's', v: 'CHANGED' } }],
      ['serie', (_, s) => { s.B2 = { t: 's', v: 'CHANGED' } }],
      ['partida', (_, s) => { s.C2 = { t: 's', v: 'CHANGED' } }],
      ['pieza', (_, s) => { s.D2 = { t: 's', v: 'CHANGED' } }],
      ['date value', (_, s) => { s.E2 = { t: 'n', v: excelSerial('2027-04-11'), z: 'dd-mm-yyyy' } }],
      ['date string', (_, s) => { s.E2 = { t: 's', v: '2027-04-10' } }],
      ['quantity string', (_, s) => { s.H2 = { t: 's', v: '2' } }],
      ['quantity decimal', (_, s) => { s.H2 = { t: 'n', v: 2.5 } }],
      ['quantity zero', (_, s) => { s.H2 = { t: 'n', v: 0 } }],
      ['quantity negative', (_, s) => { s.H2 = { t: 'n', v: -2 } }],
      ['description', (_, s) => { s.I2 = { t: 's', v: 'Changed description' } }],
      ['formula', (_, s) => { s.H2 = { t: 'n', v: 2, f: '1+1' } }],
      ['row order', (_, s) => { for (const col of 'ABCDEFGHI') { const a=s[`${col}2`]; s[`${col}2`]=s[`${col}3`]; s[`${col}3`]=a } }],
    ]
    for (const [name, change] of cases) expect(() => validateRpXlsx(corrupt(change), rows), name).toThrow()
  })
})
