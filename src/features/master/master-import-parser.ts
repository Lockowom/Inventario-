import { deriveMasterControlType, masterImportPreviewSchema, normalizeMasterCode, normalizeMasterDescription, type MasterImportPreview, type MasterImportRow } from '../../domain/master/contracts'

type CellRow = unknown[]

function detectCsvDelimiter(contents: string): ',' | ';' {
  let quoted = false
  let commas = 0
  let semicolons = 0
  for (let index = 0; index < contents.length; index += 1) {
    const character = contents[index]
    if (character === '"') {
      if (quoted && contents[index + 1] === '"') { index += 1 } else quoted = !quoted
    } else if (!quoted && (character === '\n' || character === '\r')) break
    else if (!quoted && character === ',') commas += 1
    else if (!quoted && character === ';') semicolons += 1
  }
  return semicolons > commas ? ';' : ','
}

function parseCsvRows(contents: string): CellRow[] {
  const rows: string[][] = [[]]
  const delimiter = detectCsvDelimiter(contents)
  let value = ''
  let quoted = false
  for (let index = 0; index < contents.length; index += 1) {
    const character = contents[index]
    if (character === '"') {
      if (quoted && contents[index + 1] === '"') { value += '"'; index += 1 } else quoted = !quoted
    } else if (character === delimiter && !quoted) { rows.at(-1)!.push(value); value = ''
    } else if ((character === '\n' || character === '\r') && !quoted) {
      if (character === '\r' && contents[index + 1] === '\n') index += 1
      rows.at(-1)!.push(value); value = ''; rows.push([])
    } else value += character
  }
  rows.at(-1)!.push(value)
  return rows.filter((row) => row.some((cell) => cell.trim() !== ''))
}

function cellText(value: unknown): string {
  if (value === null || value === undefined) return ''
  if (typeof value === 'object' && 'text' in value && typeof value.text === 'string') return value.text
  return String(value)
}

function descriptionKey(value: string): string {
  return normalizeMasterDescription(value).replace(/\s+/g, ' ').toUpperCase()
}

function buildPreview(rows: CellRow[]): MasterImportPreview {
  const [header = [], ...dataRows] = rows
  const headerMap = new Map(header.map((value, index) => [cellText(value).trim().toUpperCase(), index]))
  const firstColumn = (...aliases: string[]) => aliases.map((alias) => headerMap.get(alias)).find((index) => index !== undefined)
  const codigoColumn = firstColumn('CODIGO', 'COD. PRODUCTO', 'COD PRODUCTO')
  const descripcionColumn = firstColumn('DESCRIPCION', 'PRODUCTO')
  if (codigoColumn === undefined || descripcionColumn === undefined) {
    const invalidRows = dataRows.map((row, index) => ({ rowNumber: index + 2, codigo: cellText(row[0]), descripcion: cellText(row[1]), normalizedCodigo: '', normalizedDescripcion: '', errors: ['FORMATO NO SOPORTADO'] }))
    return masterImportPreviewSchema.parse({ totalRows: dataRows.length, validRows: 0, rejectedRows: invalidRows.length, duplicateRows: 0, emptyRows: 0, rows: invalidRows })
  }
  let emptyRows = 0
  const parsedRows: MasterImportRow[] = dataRows.map((row, index) => {
    const codigo = cellText(row[codigoColumn])
    const descripcion = cellText(row[descripcionColumn])
    const normalizedCodigo = normalizeMasterCode(codigo)
    const normalizedDescripcion = normalizeMasterDescription(descripcion)
    const errors: string[] = []
    if (!normalizedCodigo) errors.push('CODIGO VACIO')
    if (!normalizedDescripcion) errors.push('DESCRIPCION VACIA')
    if (!normalizedCodigo || !normalizedDescripcion) emptyRows += 1
    return { rowNumber: index + 2, codigo, descripcion, normalizedCodigo, normalizedDescripcion, controlType: normalizedCodigo ? deriveMasterControlType(normalizedCodigo) : undefined, errors }
  })
  const validRowsByCode = new Map<string, MasterImportRow[]>()
  for (const row of parsedRows) {
    if (row.errors.length > 0) continue
    const rows = validRowsByCode.get(row.normalizedCodigo) ?? []
    rows.push(row)
    validRowsByCode.set(row.normalizedCodigo, rows)
  }
  let consolidatedRows = 0
  for (const rows of validRowsByCode.values()) {
    if (rows.length < 2) continue
    if (new Set(rows.map((row) => descriptionKey(row.normalizedDescripcion))).size === 1) {
      consolidatedRows += rows.length - 1
      continue
    }
    rows.forEach((row) => row.errors.push('CODIGO CON DESCRIPCIONES EN CONFLICTO'))
  }
  const rejectedRows = parsedRows.filter((row) => row.errors.length > 0).length
  const validRows = new Set(parsedRows.filter((row) => row.errors.length === 0).map((row) => row.normalizedCodigo)).size
  return masterImportPreviewSchema.parse({ totalRows: dataRows.length, validRows, rejectedRows, duplicateRows: consolidatedRows, emptyRows, rows: parsedRows })
}

export function parseMasterCsv(contents: string): MasterImportPreview {
  return buildPreview(parseCsvRows(contents.replace(/^\uFEFF/, '')))
}

export async function parseMasterXlsx(contents: ArrayBuffer): Promise<MasterImportPreview> {
  const XLSX = await import('@e965/xlsx')
  const workbook = XLSX.read(contents, { type: 'array', cellText: true, cellNF: true })
  const sheet = workbook.Sheets[workbook.SheetNames[0] ?? '']
  if (!sheet) return buildPreview([])
  // raw: false preserves the formatted text shown by Excel (including a text code's leading zeroes).
  const rows = XLSX.utils.sheet_to_json<CellRow>(sheet, { header: 1, raw: false, defval: '' })
  return buildPreview(rows)
}

export async function parseMasterFile(file: File): Promise<MasterImportPreview> {
  const extension = file.name.split('.').pop()?.toLowerCase()
  if (extension === 'csv') return parseMasterCsv(await file.text())
  if (extension === 'xlsx') return parseMasterXlsx(await file.arrayBuffer())
  return masterImportPreviewSchema.parse({ totalRows: 0, validRows: 0, rejectedRows: 1, duplicateRows: 0, emptyRows: 0, rows: [{ rowNumber: 0, codigo: '', descripcion: '', normalizedCodigo: '', normalizedDescripcion: '', errors: ['FORMATO NO SOPORTADO'] }] })
}
