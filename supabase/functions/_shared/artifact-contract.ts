/* eslint-disable @typescript-eslint/no-explicit-any -- Edge receives JSONB source documents with variant artifact shapes. */
import * as XLSX from '@e965/xlsx'
import { unzipSync, zipSync } from 'fflate'
import { excelSerial } from './rp-contract.ts'

export const RECTIFICATION_HEADERS = ['VERSION', 'UBICACION', 'CODIGO', 'SERIE', 'PARTIDA', 'PIEZA DEL PRODUCTO', 'FECHA DE VENCIMIENTO', 'Talla del producto', 'Color del Producto', 'Cantidad Contada', 'DESCRIPCION'] as const
const encoder = new TextEncoder()
const decoder = new TextDecoder()
const sha = async (bytes: Uint8Array) => Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256', bytes as BufferSource))).map((n) => n.toString(16).padStart(2, '0')).join('')
export const sha256 = sha
export const canonicalize = (value: unknown): unknown => Array.isArray(value) ? value.map(canonicalize) : value && typeof value === 'object' ? Object.fromEntries(Object.entries(value as Record<string, unknown>).sort(([a], [b]) => a.localeCompare(b)).map(([key, item]) => [key, canonicalize(item)])) : value
export const canonicalJson = (value: unknown) => encoder.encode(JSON.stringify(canonicalize(value)))
const isoDate = (value: unknown) => typeof value === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(value) ? value : null
// fflate serializes ZIP timestamps with local Date getters.  A local noon in
// the first legal DOS year keeps the encoded date fixed across timezones.
export const ZIP_MTIME = new Date(1980, 0, 1, 12, 0, 0)
const physicalRow = (version: string, value: Record<string, unknown>) => [version, value.ubicacion ?? null, value.codigo ?? null, value.serie ?? null, value.partida ?? null, value.pieza_producto ?? null, isoDate(value.fecha_vencimiento), value.talla ?? null, value.color ?? null, value.cantidad_contada ?? null, value.descripcion ?? null]

export function rectificationFileName(source: any) {
  return `INVEN3_${String(source.inventory.id).replaceAll('-', '').toUpperCase()}_CORTE_${String(source.cut.cut_number).padStart(3, '0')}_RECTIFICACION_${String(source.rectification.rectification_number).padStart(3, '0')}.xlsx`
}

export function generateRectificationXlsx(source: any) {
  const rectification = source.rectification
  const details = [
    ['CAMPO', 'VALOR'], ['inventory_id', source.inventory.id], ['cut_id', source.cut.id], ['rectification_id', rectification.id], ['rectification_number', rectification.rectification_number], ['count_record_id', rectification.count_record_id], ['actor_user_id', rectification.created_by], ['created_at', rectification.created_at], ['reason', rectification.reason], ['request_id', rectification.request_id], ['old_values_sha256', rectification.old_values_sha256], ['new_values_sha256', rectification.new_values_sha256],
  ]
  const valueSheet = XLSX.utils.aoa_to_sheet([[...RECTIFICATION_HEADERS], physicalRow('ANTERIOR', rectification.old_values), physicalRow('CORRECTO', rectification.new_values)], { cellDates: true })
  for (const row of [2, 3]) {
    for (const column of ['A', 'B', 'C', 'D', 'E', 'F', 'H', 'I', 'K']) { const cell = valueSheet[`${column}${row}`]; if (cell) cell.z = '@' }
    const date = isoDate((row === 2 ? rectification.old_values : rectification.new_values).fecha_vencimiento)
    if (date) valueSheet[`G${row}`] = { t: 'n', v: excelSerial(date), z: 'dd-mm-yyyy' }
    const quantity = valueSheet[`J${row}`]; if (quantity) quantity.z = '0'
  }
  const workbook = XLSX.utils.book_new(); XLSX.utils.book_append_sheet(workbook, XLSX.utils.aoa_to_sheet(details), 'RECTIFICACION'); XLSX.utils.book_append_sheet(workbook, valueSheet, 'VALORES')
  return new Uint8Array(XLSX.write(workbook, { bookType: 'xlsx', type: 'array', cellDates: true }))
}

export function validateRectificationXlsx(bytes: Uint8Array, source: any) {
  // Physical validation must keep numeric Excel serials numeric.  With
  // cellDates:true SheetJS may materialize the same correct cell as Date/t=d.
  const workbook = XLSX.read(bytes, { type: 'array', cellDates: false, cellFormula: true, cellNF: true })
  if (JSON.stringify(workbook.SheetNames) !== JSON.stringify(['RECTIFICACION', 'VALORES'])) throw new Error('Invalid RECTIFICATION_XLSX sheets')
  for (const sheet of Object.values(workbook.Sheets)) for (const cell of Object.values(sheet ?? {})) if (typeof cell === 'object' && cell && 'f' in cell) throw new Error('XLSX formulas are forbidden')
  const values = XLSX.utils.sheet_to_json<unknown[]>(workbook.Sheets.VALORES!, { header: 1, raw: true, defval: null })
  if (JSON.stringify(values[0]) !== JSON.stringify(RECTIFICATION_HEADERS) || values.length !== 3) throw new Error('Invalid RECTIFICATION_XLSX headers')
  ;[['ANTERIOR', source.rectification.old_values], ['CORRECTO', source.rectification.new_values]].forEach(([version, sourceValues], index) => {
    const row = values[index + 1] as unknown[]; const expected = physicalRow(version as string, sourceValues as Record<string, unknown>)
    if (!row || row.length !== expected.length || row.some((value, column) => column === 6 ? false : value !== expected[column])) throw new Error('RECTIFICATION_XLSX round-trip mismatch')
    const date = isoDate((sourceValues as Record<string, unknown>).fecha_vencimiento)
    const cell = workbook.Sheets.VALORES![`G${index + 2}`]
    if (date && (!cell || cell.t !== 'n' || Number(cell.v) !== excelSerial(date) || cell.z !== 'dd-mm-yyyy')) throw new Error('RECTIFICATION_XLSX date mismatch')
    if (!date && row[6] !== null) throw new Error('RECTIFICATION_XLSX blank date mismatch')
  })
}

export function buildSnapshot(source: any) {
  return canonicalJson({
    version: 'INVEN3_SNAPSHOT_V1', inventory: source.inventory, cut: source.cut,
    cut_items: source.cut_items, cut_xlsx: source.cut_xlsx,
    manifest: { artifact_generation_id: source.generation.id, artifact_type: 'SNAPSHOT', scope: 'CUT_SNAPSHOT', as_of_at: source.generation.as_of_at },
  })
}
export function validateSnapshot(bytes: Uint8Array, source: any) {
  const actual = decoder.decode(bytes); if (actual.charCodeAt(0) === 0xfeff) throw new Error('Snapshot must not have BOM')
  if (actual !== decoder.decode(buildSnapshot(source))) throw new Error('Snapshot is not canonical or its source changed')
  const parsed = JSON.parse(actual); if (parsed.version !== 'INVEN3_SNAPSHOT_V1' || !Array.isArray(parsed.cut_items)) throw new Error('Snapshot contract invalid')
}

const ndjson = (items: unknown[]) => encoder.encode(items.map((item) => JSON.stringify(canonicalize(item))).join(items.length ? '\n' : '') + (items.length ? '\n' : ''))
export async function buildTechnicalBackup(source: any) {
  const members: Record<string, Uint8Array> = {
    'inventory.json': canonicalJson(source.inventory),
    'cuts.ndjson': ndjson(source.cuts),
    'cut-items.ndjson': ndjson(source.cut_items),
    'rectifications.ndjson': ndjson(source.rectifications),
    'artifacts.ndjson': ndjson(source.artifacts),
  }
  const manifestMembers = await Promise.all(Object.entries(members).map(async ([name, bytes]) => ({ name, sha256: await sha(bytes), size_bytes: bytes.byteLength, count: name.endsWith('.ndjson') ? (decoder.decode(bytes).match(/\n/g) ?? []).length : 1 })))
  const manifest = canonicalJson({ version: 'INVEN3_TECHNICAL_BACKUP_V1', artifact_generation_id: source.generation.id, inventory_id: source.inventory.id, scope: source.generation.scope, as_of_at: source.generation.as_of_at, members: manifestMembers })
  // Copy into this module's Uint8Array realm: fflate uses instanceof checks
  // while test/browser runtimes can provide cross-realm typed arrays.
  const zipMembers = Object.fromEntries(Object.entries(members).map(([name, bytes]) => [name, [new Uint8Array(bytes), { mtime: ZIP_MTIME, level: 0 }]]))
  return zipSync({ 'manifest.json': [new Uint8Array(manifest), { mtime: ZIP_MTIME, level: 0 }], ...zipMembers }, { mtime: ZIP_MTIME, level: 0 })
}
export async function validateTechnicalBackup(bytes: Uint8Array, source: any) {
  const entries = unzipSync(bytes); const names = Object.keys(entries)
  const expected = ['manifest.json', 'inventory.json', 'cuts.ndjson', 'cut-items.ndjson', 'rectifications.ndjson', 'artifacts.ndjson']
  if (JSON.stringify(names) !== JSON.stringify(expected) || names.some((name) => name.includes('..') || name.startsWith('/'))) throw new Error(`Backup members are invalid: ${names.join(',')}`)
  const rebuilt = await buildTechnicalBackup(source); if (JSON.stringify(Array.from(bytes)) !== JSON.stringify(Array.from(rebuilt))) throw new Error('Backup is not deterministic')
  const manifest = JSON.parse(decoder.decode(entries['manifest.json']!)); if (manifest.version !== 'INVEN3_TECHNICAL_BACKUP_V1' || manifest.as_of_at !== source.generation.as_of_at) throw new Error('Backup manifest is invalid')
}
