import { deriveMasterControlType, masterImportPreviewSchema, normalizeMasterCode, normalizeMasterDescription, type MasterImportPreview, type MasterImportRow } from '../../domain/master/contracts'

type CellRow = unknown[]
type Delimiter = ',' | ';' | '\t'

function detectDelimiter(contents: string): Delimiter {
  let quoted = false
  let commas = 0
  let semicolons = 0
  let tabs = 0
  for (let index = 0; index < contents.length; index += 1) {
    const character = contents[index]
    if (character === '"') {
      if (quoted && contents[index + 1] === '"') index += 1
      else quoted = !quoted
    } else if (!quoted && (character === '\n' || character === '\r')) break
    else if (!quoted && character === ',') commas += 1
    else if (!quoted && character === ';') semicolons += 1
    else if (!quoted && character === '\t') tabs += 1
  }
  if (tabs >= commas && tabs >= semicolons && tabs > 0) return '\t'
  return semicolons > commas ? ';' : ','
}

function parseDelimitedRows(contents: string): CellRow[] {
  const rows: string[][] = [[]]
  const delimiter = detectDelimiter(contents)
  let value = ''
  let quoted = false

  for (let index = 0; index < contents.length; index += 1) {
    const character = contents[index]
    if (character === '"') {
      if (quoted && contents[index + 1] === '"') { value += '"'; index += 1 }
      else quoted = !quoted
    } else if (character === delimiter && !quoted) {
      rows.at(-1)!.push(value); value = ''
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

function invalidPreview(rows: CellRow[], rowOffset = 1): MasterImportPreview {
  const invalidRows = rows.map((row, index) => ({
    rowNumber: index + rowOffset,
    codigo: cellText(row[0]),
    descripcion: cellText(row[1]),
    normalizedCodigo: '',
    normalizedDescripcion: '',
    errors: ['FORMATO NO SOPORTADO'],
  }))
  return masterImportPreviewSchema.parse({
    totalRows: rows.length,
    validRows: 0,
    rejectedRows: Math.max(1, invalidRows.length),
    duplicateRows: 0,
    emptyRows: 0,
    rows: invalidRows.length ? invalidRows : [{
      rowNumber: 1,
      codigo: '',
      descripcion: '',
      normalizedCodigo: '',
      normalizedDescripcion: '',
      errors: ['FORMATO NO SOPORTADO'],
    }],
  })
}

function buildPreview(rows: CellRow[]): MasterImportPreview {
  if (rows.length === 0) return invalidPreview([])

  const firstRow = rows[0] ?? []
  const headerMap = new Map(firstRow.map((value, index) => [cellText(value).trim().toUpperCase(), index]))
  const firstColumn = (...aliases: string[]) => aliases.map((alias) => headerMap.get(alias)).find((index) => index !== undefined)
  let codigoColumn = firstColumn('CODIGO', 'COD. PRODUCTO', 'COD PRODUCTO')
  let descripcionColumn = firstColumn('DESCRIPCION', 'PRODUCTO')
  const hasKnownHeader = codigoColumn !== undefined || descripcionColumn !== undefined

  let dataRows: CellRow[]
  let rowOffset: number
  if (hasKnownHeader) {
    if (codigoColumn === undefined || descripcionColumn === undefined) return invalidPreview(rows.slice(1), 2)
    dataRows = rows.slice(1)
    rowOffset = 2
  } else {
    if (firstRow.length < 2) return invalidPreview(rows)
    codigoColumn = 0
    descripcionColumn = 1
    dataRows = rows
    rowOffset = 1
  }

  let emptyRows = 0
  const parsedRows: MasterImportRow[] = dataRows.map((row, index) => {
    const codigo = cellText(row[codigoColumn!])
    const descripcion = cellText(row[descripcionColumn!])
    const normalizedCodigo = normalizeMasterCode(codigo)
    const normalizedDescripcion = normalizeMasterDescription(descripcion)
    const errors: string[] = []
    if (!normalizedCodigo) errors.push('CODIGO VACIO')
    if (!normalizedDescripcion) errors.push('DESCRIPCION VACIA')
    if (!normalizedCodigo || !normalizedDescripcion) emptyRows += 1
    return {
      rowNumber: index + rowOffset,
      codigo,
      descripcion,
      normalizedCodigo,
      normalizedDescripcion,
      controlType: normalizedCodigo ? deriveMasterControlType(normalizedCodigo) : undefined,
      errors,
    }
  })

  const validRowsByCode = new Map<string, MasterImportRow[]>()
  for (const row of parsedRows) {
    if (row.errors.length > 0) continue
    const grouped = validRowsByCode.get(row.normalizedCodigo) ?? []
    grouped.push(row)
    validRowsByCode.set(row.normalizedCodigo, grouped)
  }

  let consolidatedRows = 0
  for (const grouped of validRowsByCode.values()) {
    if (grouped.length < 2) continue
    if (new Set(grouped.map((row) => descriptionKey(row.normalizedDescripcion))).size === 1) {
      consolidatedRows += grouped.length - 1
      continue
    }
    grouped.forEach((row) => row.errors.push('CODIGO CON DESCRIPCIONES EN CONFLICTO'))
  }

  const rejectedRows = parsedRows.filter((row) => row.errors.length > 0).length
  const validRows = new Set(parsedRows.filter((row) => row.errors.length === 0).map((row) => row.normalizedCodigo)).size
  return masterImportPreviewSchema.parse({
    totalRows: dataRows.length,
    validRows,
    rejectedRows,
    duplicateRows: consolidatedRows,
    emptyRows,
    rows: parsedRows,
  })
}

export function parseMasterCsv(contents: string): MasterImportPreview {
  return buildPreview(parseDelimitedRows(contents.replace(/^\uFEFF/, '')))
}

export function parseMasterClipboard(contents: string): MasterImportPreview {
  return parseMasterCsv(contents)
}

export async function parseMasterXlsx(contents: ArrayBuffer): Promise<MasterImportPreview> {
  const XLSX = await import('@e965/xlsx')
  const workbook = XLSX.read(contents, { type: 'array', cellText: true, cellNF: true })
  const preferred = workbook.SheetNames.find((name) => name.trim().toUpperCase() === 'STOCK TOTAL')
  const sheet = workbook.Sheets[preferred ?? workbook.SheetNames[0] ?? '']
  if (!sheet) return invalidPreview([])
  const rows = XLSX.utils.sheet_to_json<CellRow>(sheet, { header: 1, raw: false, defval: '' })
  return buildPreview(rows)
}

export async function parseMasterFile(file: File): Promise<MasterImportPreview> {
  const extension = file.name.split('.').pop()?.toLowerCase()
  if (extension === 'csv' || extension === 'tsv' || extension === 'txt') return parseMasterCsv(await file.text())
  if (extension === 'xlsx') return parseMasterXlsx(await file.arrayBuffer())
  return invalidPreview([])
}
