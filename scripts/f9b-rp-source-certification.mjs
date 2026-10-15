import { createHash } from 'node:crypto'
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { basename, join, resolve } from 'node:path'
import * as XLSX from '@e965/xlsx'

const fileArg = process.argv[2] || process.env.F9B_RP_SOURCE_FILE
if (!fileArg) throw new Error('Uso: npm run certify:f9b:rp-source -- "C:\\ruta\\STOCK RP.xlsx"')
const filePath = resolve(fileArg)
if (!existsSync(filePath)) throw new Error(`Archivo RP no encontrado: ${filePath}`)

const bytes = readFileSync(filePath)
const sha256 = createHash('sha256').update(bytes).digest('hex')
const workbook = XLSX.read(bytes, { type: 'buffer', cellDates: true, cellFormula: true })

const expectedSheets = ['STOCK TOTAL', 'STOCK CON P', 'STOCK CON S']
const headers = {
  'STOCK TOTAL': ['Cod. Producto', 'Producto', 'Cod. U. Medida', 'Disponible', 'Reserva', 'Transitoria', 'Consignación', 'Stock Total'],
  'STOCK CON P': ['Cod. Producto', 'Producto', 'Cod. U. Medida', 'Partida / Talla', 'Fecha Venc', 'Disponible', 'Reserva', 'Transitoria', 'Consignación', 'Stock Total'],
  'STOCK CON S': ['Cod. Producto', 'Producto', 'Cod. U. Medida', 'Serie', 'Disponible', 'Reserva', 'Transitoria', 'Consignación', 'Stock Total'],
}
const stockCols = ['Disponible', 'Reserva', 'Transitoria', 'Consignación', 'Stock Total']
const failures = []
const warnings = []
const checks = []

function pass(name, detail = '') {
  checks.push({ name, status: 'PASS', detail })
  console.log(`[PASS] ${name}${detail ? `: ${detail}` : ''}`)
}
function warn(name, detail) {
  warnings.push({ name, detail })
  checks.push({ name, status: 'WARN', detail })
  console.log(`[WARN] ${name}: ${detail}`)
}
function fail(name, detail) {
  failures.push({ name, detail })
  checks.push({ name, status: 'FAIL', detail })
  console.log(`[FAIL] ${name}: ${detail}`)
}
function text(value) {
  return value == null ? '' : String(value)
}
function code(value) {
  return text(value).trim().toUpperCase()
}
function number(value) {
  if (value === null || value === undefined || value === '') return 0
  const n = Number(value)
  return Number.isFinite(n) ? n : Number.NaN
}
function rows(sheetName) {
  const actualName = actualSheetName(sheetName)
  const sheet = workbook.Sheets[actualName]
  if (!sheet) return []
  return XLSX.utils.sheet_to_json(sheet, { defval: null, raw: true })
}
function formulas(sheetName) {
  const actualName = actualSheetName(sheetName)
  const sheet = workbook.Sheets[actualName]
  if (!sheet) return []
  return Object.entries(sheet)
    .filter(([address, cell]) => !address.startsWith('!') && cell && typeof cell === 'object' && 'f' in cell && cell.f)
    .map(([address, cell]) => ({ address, formula: cell.f }))
}
function aggregate(input) {
  const map = new Map()
  for (const row of input) {
    const sku = code(row['Cod. Producto'])
    if (!sku) continue
    const current = map.get(sku) || Object.fromEntries(stockCols.map((col) => [col, 0]))
    for (const col of stockCols) current[col] += number(row[col])
    map.set(sku, current)
  }
  return map
}
function sameStock(a, b) {
  for (const col of stockCols) if (a[col] !== b[col]) return false
  return true
}

console.log('')
console.log('F9B — CERTIFICACIÓN FUENTE REAL RP')
console.log(`Archivo: ${basename(filePath)}`)
console.log(`SHA256: ${sha256}`)
console.log(`Bytes:   ${bytes.length}`)
console.log('')

const actualSheets = workbook.SheetNames
const normalizedSheetMap = new Map(actualSheets.map((name) => [name.trim().toUpperCase(), name]))
const normalizedSheets = actualSheets.map((name) => name.trim().toUpperCase())

if (JSON.stringify(normalizedSheets) === JSON.stringify(expectedSheets)) {
  pass('SHEETS', actualSheets.join(', '))
  const renamed = actualSheets.filter((name, index) => name !== expectedSheets[index])
  if (renamed.length) warn('SHEET_NAME_WHITESPACE', `nombres normalizados: ${JSON.stringify(renamed)}`)
} else {
  fail('SHEETS', `esperado=${JSON.stringify(expectedSheets)} recibido=${JSON.stringify(actualSheets)}`)
}

function actualSheetName(logicalName) {
  return normalizedSheetMap.get(logicalName.trim().toUpperCase()) ?? logicalName
}

for (const sheetName of expectedSheets) {
  const actualName = actualSheetName(sheetName)
  const sheet = workbook.Sheets[actualName]
  if (!sheet) continue
  const matrix = XLSX.utils.sheet_to_json(sheet, { header: 1, defval: null, raw: false })
  const actualHeader = (matrix[0] || []).map((v) => text(v))
  if (JSON.stringify(actualHeader) === JSON.stringify(headers[sheetName])) pass(`HEADERS_${sheetName.replace(/\s+/g, '_')}`)
  else fail(`HEADERS_${sheetName.replace(/\s+/g, '_')}`, `esperado=${JSON.stringify(headers[sheetName])} recibido=${JSON.stringify(actualHeader)}`)
  const sheetFormulas = formulas(sheetName)
  if (sheetFormulas.length === 0) pass(`NO_FORMULAS_${sheetName.replace(/\s+/g, '_')}`)
  else fail(`NO_FORMULAS_${sheetName.replace(/\s+/g, '_')}`, `${sheetFormulas.length} celdas con fórmula`)
}

const totalRows = rows('STOCK TOTAL')
const pRows = rows('STOCK CON P')
const sRows = rows('STOCK CON S')
const totalCodes = totalRows.map((r) => code(r['Cod. Producto'])).filter(Boolean)
const pCodes = pRows.map((r) => code(r['Cod. Producto'])).filter(Boolean)
const sCodes = sRows.map((r) => code(r['Cod. Producto'])).filter(Boolean)

if (new Set(totalCodes).size === totalCodes.length) pass('STOCK_TOTAL_SKU_UNIQUE', `${totalCodes.length} SKU`)
else fail('STOCK_TOTAL_SKU_UNIQUE', `${totalCodes.length - new Set(totalCodes).size} duplicados`)

const totalSet = new Set(totalCodes)
const pSet = new Set(pCodes)
const sSet = new Set(sCodes)
const sameUniverse = totalSet.size === pSet.size && totalSet.size === sSet.size &&
  [...totalSet].every((sku) => pSet.has(sku) && sSet.has(sku))
if (sameUniverse) pass('SKU_UNIVERSE', `${totalSet.size} SKU comunes`)
else fail('SKU_UNIVERSE', `TOTAL=${totalSet.size} P=${pSet.size} S=${sSet.size}`)

for (const [sheetName, input] of [['STOCK TOTAL', totalRows], ['STOCK CON P', pRows], ['STOCK CON S', sRows]]) {
  const badNumeric = []
  const badEquation = []
  const negative = []
  const whitespaceCodes = []
  for (const row of input) {
    const rawCode = text(row['Cod. Producto'])
    if (rawCode !== rawCode.trim()) whitespaceCodes.push(rawCode)
    const vals = stockCols.map((col) => number(row[col]))
    if (vals.some((v) => !Number.isInteger(v))) badNumeric.push(rawCode)
    const [disponible, reserva, transitoria, consignacion, total] = vals
    if ([disponible, reserva, transitoria, consignacion].some((v) => v < 0)) negative.push({ code: rawCode, disponible, reserva, transitoria, consignacion, total })
    if (disponible + reserva + transitoria + consignacion !== total) badEquation.push(rawCode)
  }
  const token = sheetName.replace(/\s+/g, '_')
  if (!badNumeric.length) pass(`INTEGER_STOCK_${token}`)
  else fail(`INTEGER_STOCK_${token}`, `${badNumeric.length} filas no enteras`)
  if (!badEquation.length) pass(`STOCK_EQUATION_${token}`)
  else fail(`STOCK_EQUATION_${token}`, `${badEquation.length} filas no cuadran`)
  if (negative.length) warn(`NEGATIVE_STOCK_${token}`, JSON.stringify(negative.slice(0, 10)))
  if (whitespaceCodes.length) warn(`SKU_WHITESPACE_${token}`, `${new Set(whitespaceCodes).size} SKU con espacios externos`)
}

const baseAgg = aggregate(totalRows)
for (const [sheetName, input] of [['STOCK CON P', pRows], ['STOCK CON S', sRows]]) {
  const other = aggregate(input)
  const mismatches = []
  for (const [sku, stock] of baseAgg.entries()) {
    const candidate = other.get(sku)
    if (!candidate || !sameStock(stock, candidate)) mismatches.push(sku)
  }
  if (!mismatches.length) pass(`RECONCILE_${sheetName.replace(/\s+/g, '_')}`, '0 diferencias por SKU')
  else fail(`RECONCILE_${sheetName.replace(/\s+/g, '_')}`, `${mismatches.length} SKU distintos`)
}

const partidaKeys = new Set()
const duplicatePartidas = []
const missingPartidaPositive = []
const parsedDates = []
const invalidDates = []
for (const row of pRows) {
  const sku = code(row['Cod. Producto'])
  const partida = text(row['Partida / Talla']).trim()
  const stock = number(row['Stock Total'])
  if (partida) {
    const key = `${sku}\u001f${partida}`
    if (partidaKeys.has(key)) duplicatePartidas.push({ sku, partida })
    partidaKeys.add(key)
  } else if (sku.endsWith('P') && stock > 0) {
    missingPartidaPositive.push({ sku, stock })
  }
  const value = row['Fecha Venc']
  if (value != null && value !== '') {
    let d = null
    if (value instanceof Date && !Number.isNaN(value.getTime())) d = value
    else if (typeof value === 'number') {
      const parsed = XLSX.SSF.parse_date_code(value)
      if (parsed) d = new Date(Date.UTC(parsed.y, parsed.m - 1, parsed.d))
    } else if (typeof value === 'string') {
      const match = value.trim().match(/^(\d{1,2})[/-](\d{1,2})[/-](\d{4})$/)
      if (match) d = new Date(Date.UTC(Number(match[3]), Number(match[2]) - 1, Number(match[1])))
    }
    if (d && !Number.isNaN(d.getTime())) parsedDates.push(d)
    else invalidDates.push({ sku, value })
  }
}
if (!duplicatePartidas.length) pass('PARTIDA_UNIQUENESS')
else fail('PARTIDA_UNIQUENESS', `${duplicatePartidas.length} duplicados SKU+partida`)
if (missingPartidaPositive.length) warn('PARTIDA_MISSING_POSITIVE', `${missingPartidaPositive.length} SKU P con stock positivo sin partida/talla; ${missingPartidaPositive.reduce((sum, row) => sum + row.stock, 0)} unidades`)
if (!invalidDates.length) pass('EXPIRY_PARSE', `${parsedDates.length} fechas válidas`)
else fail('EXPIRY_PARSE', `${invalidDates.length} fechas inválidas`)
const oldDates = parsedDates.filter((d) => d.getUTCFullYear() < 2000)
if (oldDates.length) warn('EXPIRY_OUTLIERS', `${oldDates.length} fechas anteriores a 2000: ${oldDates.map((d) => d.toISOString().slice(0, 10)).join(', ')}`)

const seenSeries = new Set()
const duplicateSeries = []
const invalidSeriesQuantity = []
const serialCodes = new Set()
for (const row of sRows) {
  const sku = code(row['Cod. Producto'])
  const serie = text(row['Serie']).trim()
  if (!serie) continue
  serialCodes.add(sku)
  if (seenSeries.has(serie)) duplicateSeries.push({ sku, serie })
  seenSeries.add(serie)
  if (number(row['Stock Total']) !== 1) invalidSeriesQuantity.push({ sku, serie, stock: row['Stock Total'] })
  if (!sku.endsWith('S')) fail('SERIAL_SUFFIX', `serie ${serie} pertenece a SKU no-S ${sku}`)
}
if (!duplicateSeries.length) pass('SERIAL_UNIQUENESS', `${seenSeries.size} series`)
else fail('SERIAL_UNIQUENESS', `${duplicateSeries.length} series duplicadas`)
if (!invalidSeriesQuantity.length) pass('SERIAL_QUANTITY_ONE')
else fail('SERIAL_QUANTITY_ONE', `${invalidSeriesQuantity.length} series con cantidad distinta de 1`)
pass('SERIAL_SKU_COUNT', `${serialCodes.size} SKU S con detalle`)

const evidence = {
  schema: 'inven3.f9b.rp-source-certification.v1',
  execution_id: `RP-SOURCE-${new Date().toISOString().replace(/[-:.TZ]/g, '').slice(0, 14)}`,
  file_name: basename(filePath),
  sha256,
  size_bytes: bytes.length,
  sheet_names: actualSheets,
  row_counts: {
    stock_total: totalRows.length,
    stock_con_p: pRows.length,
    stock_con_s: sRows.length,
  },
  unique_sku_count: totalSet.size,
  series_count: seenSeries.size,
  serial_sku_count: serialCodes.size,
  expiry_count: parsedDates.length,
  warnings,
  failures,
  checks,
  status: failures.length ? 'FAIL' : warnings.length ? 'PASS_WITH_WARNINGS' : 'PASS',
  generated_at: new Date().toISOString(),
}

const dir = join(process.cwd(), 'artifacts', 'f9b-rp-source')
mkdirSync(dir, { recursive: true })
const evidencePath = join(dir, `${evidence.execution_id}.json`)
writeFileSync(evidencePath, JSON.stringify(evidence, null, 2) + '\n')

console.log('')
console.log(`[${evidence.status}] RP_SOURCE_REAL_DATASET`)
console.log(`Evidencia: ${evidencePath}`)
if (failures.length) process.exitCode = 2
