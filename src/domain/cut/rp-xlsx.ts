import * as XLSX from '@e965/xlsx'
import { assertRpSnapshot, excelSerial, isoDateUtc, RP_HEADERS, rpRow, type RpSnapshot } from '../../../supabase/functions/_shared/rp-contract.ts'

export { assertRpSnapshot, RP_HEADERS, type RpSnapshot }

export function generateRpXlsx(rows: RpSnapshot[]) {
  assertRpSnapshot(rows)
  const sheet = XLSX.utils.aoa_to_sheet([[...RP_HEADERS], ...rows.map(rpRow)], { cellDates: true })
  sheet['!ref'] = `A1:I${rows.length + 1}`
  for (let row = 2; row <= rows.length + 1; row += 1) {
    for (const col of ['A', 'B', 'C', 'D', 'F', 'G', 'I']) { const cell = sheet[`${col}${row}`]; if (cell) cell.z = '@' }
    const serial = excelSerial(rows[row - 2]!.fecha_vencimiento); if (serial !== null) sheet[`E${row}`] = { t: 'n', v: serial, z: 'dd-mm-yyyy' }
    const quantity = sheet[`H${row}`]; if (quantity) quantity.z = '0'
  }
  const workbook = XLSX.utils.book_new(); XLSX.utils.book_append_sheet(workbook, sheet, 'INVENTARIO')
  return new Uint8Array(XLSX.write(workbook, { bookType: 'xlsx', type: 'array', cellDates: true }))
}

export function validateRpXlsx(bytes: Uint8Array, expected: RpSnapshot[]) {
  assertRpSnapshot(expected)
  const workbook = XLSX.read(bytes, { type: 'array', cellDates: true, cellFormula: true })
  if (workbook.SheetNames.length !== 1 || workbook.SheetNames[0] !== 'INVENTARIO') throw new Error('RP workbook must have exactly one INVENTARIO sheet.')
  const sheet = workbook.Sheets.INVENTARIO
  if (!sheet || sheet['!ref'] !== `A1:I${expected.length + 1}`) throw new Error('RP workbook range is invalid.')
  const rows = XLSX.utils.sheet_to_json<unknown[]>(sheet, { header: 1, raw: true, defval: null })
  if (JSON.stringify(rows[0]) !== JSON.stringify(RP_HEADERS)) throw new Error('RP headers do not match the exact contract.')
  Object.values(sheet).forEach((cell) => { if (typeof cell === 'object' && cell && 'f' in cell) throw new Error('RP workbook must not contain formulas.') })
  expected.forEach((item, index) => {
    const row = rows[index + 1] as unknown[] | undefined; const expectedRow=rpRow(item)
    if (!row || row.length !== 9 || row.some((value,column) => column === 4 ? false : value !== expectedRow[column])) throw new Error(`RP round-trip mismatch at export_seq ${item.export_seq}.`)
    const cell = sheet[`E${index + 2}`]; const parsed = cell?.t === 'n' ? XLSX.SSF.parse_date_code(Number(cell.v)) : null; const dateValue = cell?.v instanceof Date ? cell.v : parsed ? new Date(Date.UTC(parsed.y, parsed.m - 1, parsed.d)) : null
    if (item.fecha_vencimiento ? !cell || !['n', 'd'].includes(cell.t ?? '') || isoDateUtc(dateValue) !== item.fecha_vencimiento : row[4] !== null) throw new Error(`RP date mismatch at export_seq ${item.export_seq}.`)
  })
}
