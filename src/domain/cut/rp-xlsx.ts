import * as XLSX from '@e965/xlsx'

export const RP_HEADERS = ['CODIGO', 'SERIE', 'PARTIDA', 'PIEZA DEL PRODUCTO', 'FECHA DE VENCIMIENTO', 'Talla del producto', 'Color del Producto', 'Cantidad Contada', 'DESCRIPCION'] as const
export type RpSnapshot = { export_seq: number; codigo: string; serie?: string | null; partida?: string | null; pieza_producto?: string | null; fecha_vencimiento?: string | null; talla?: string | null; color?: string | null; cantidad_contada: number; descripcion: string }

function nullableText(value: string | null | undefined) { return value ?? '' }
function date(value: string | null | undefined) { return value ? new Date(`${value}T00:00:00.000Z`) : '' }

export function assertRpSnapshot(rows: RpSnapshot[]) {
  if (!rows.length) throw new Error('A cut requires at least one immutable snapshot.')
  rows.forEach((row, index) => {
    if (!Number.isInteger(row.export_seq) || row.export_seq !== rows[0]!.export_seq + index) throw new Error('Snapshot export_seq must be contiguous and ordered.')
    if (!Number.isInteger(row.cantidad_contada) || row.cantidad_contada <= 0) throw new Error('Snapshot quantity must be a positive integer.')
  })
}

export function generateRpXlsx(rows: RpSnapshot[]) {
  assertRpSnapshot(rows)
  const sheet = XLSX.utils.aoa_to_sheet([[...RP_HEADERS], ...rows.map((row) => [row.codigo, nullableText(row.serie), nullableText(row.partida), nullableText(row.pieza_producto), date(row.fecha_vencimiento), nullableText(row.talla), nullableText(row.color), row.cantidad_contada, row.descripcion])], { cellDates: true })
  sheet['!ref'] = `A1:I${rows.length + 1}`
  for (let row = 2; row <= rows.length + 1; row += 1) {
    for (const col of ['A', 'B', 'C', 'D', 'F', 'G', 'I']) { const cell = sheet[`${col}${row}`]; if (cell) cell.z = '@' }
    const expiration = sheet[`E${row}`]; if (expiration && expiration.v !== '') expiration.z = 'dd-mm-yyyy'
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
  const rows = XLSX.utils.sheet_to_json<unknown[]>(sheet, { header: 1, raw: true, defval: '' })
  if (JSON.stringify(rows[0]) !== JSON.stringify(RP_HEADERS)) throw new Error('RP headers do not match the exact contract.')
  Object.values(sheet).forEach((cell) => { if (typeof cell === 'object' && cell && 'f' in cell) throw new Error('RP workbook must not contain formulas.') })
  expected.forEach((item, index) => {
    const row = rows[index + 1] as unknown[] | undefined
    if (!row || row.length !== 9 || row[0] !== item.codigo || row[1] !== nullableText(item.serie) || row[2] !== nullableText(item.partida) || row[3] !== nullableText(item.pieza_producto) || row[5] !== nullableText(item.talla) || row[6] !== nullableText(item.color) || row[7] !== item.cantidad_contada || row[8] !== item.descripcion) throw new Error(`RP round-trip mismatch at export_seq ${item.export_seq}.`)
    const cell = sheet[`E${index + 2}`]; if (item.fecha_vencimiento ? !cell || !['n', 'd'].includes(cell.t ?? '') : row[4] !== '') throw new Error(`RP date mismatch at export_seq ${item.export_seq}.`)
  })
}
