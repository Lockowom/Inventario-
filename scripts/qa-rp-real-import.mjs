import { createHash } from 'node:crypto'
import { execFileSync } from 'node:child_process'
import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import * as XLSX from '@e965/xlsx'

const expected = {
  fileName: 'STOCK RP(2).xlsx',
  size: 442498,
  sha256: '6b43ab792ca73210888c316c2886d373a7d4b937f22f3b0145ce272c36f54fa3',
  sheets: ['STOCK TOTAL', 'STOCK CON P', 'STOCK CON S'],
}
const input = process.argv[2]
if (!input) throw new Error('Uso: node scripts/qa-rp-real-import.mjs "C:\\ruta\\STOCK RP(2).xlsx"')
if (!existsSync(input)) throw new Error('No se encontró la fuente RP indicada.')

const bytes = readFileSync(input)
const sha256 = createHash('sha256').update(bytes).digest('hex')
if (bytes.length !== expected.size || sha256 !== expected.sha256) {
  throw new Error(`La fuente no coincide: bytes=${bytes.length}; sha256=${sha256}`)
}

const workbook = XLSX.read(bytes, { type: 'buffer', cellDates: true })
const sheets = new Map(workbook.SheetNames.map((name) => [name.trim().toUpperCase(), name]))
for (const required of expected.sheets) if (!sheets.has(required)) throw new Error(`Falta la hoja requerida: ${required}`)

const readRows = (logicalName) => XLSX.utils.sheet_to_json(workbook.Sheets[sheets.get(logicalName)], { defval: null, raw: true })
const text = (value) => value == null ? '' : String(value)
const code = (value) => text(value).trim().toUpperCase()
const integer = (value) => {
  if (value == null || value === '') return 0
  const parsed = Number(value)
  if (!Number.isInteger(parsed)) throw new Error(`Stock no entero para valor ${text(value)}`)
  return parsed
}
const date = (value) => {
  if (value == null || value === '') return null
  if (value instanceof Date && !Number.isNaN(value.getTime())) return value.toISOString().slice(0, 10)
  if (typeof value === 'number') {
    const parsed = XLSX.SSF.parse_date_code(value)
    if (parsed) return `${parsed.y}-${String(parsed.m).padStart(2, '0')}-${String(parsed.d).padStart(2, '0')}`
  }
  const match = text(value).trim().match(/^(\d{1,2})[/-](\d{1,2})[/-](\d{4})$/)
  if (match) return `${match[3]}-${match[2].padStart(2, '0')}-${match[1].padStart(2, '0')}`
  throw new Error(`Fecha de vencimiento no interpretable: ${text(value)}`)
}
const control = (sku) => sku.endsWith('S') ? 'SERIAL' : sku.endsWith('P') ? 'PARTIDA' : 'LEGACY'
const stock = (row) => ({
  total: integer(row['Stock Total']),
  available: integer(row.Disponible),
  reserve: integer(row.Reserva),
  transitory: integer(row.Transitoria),
  consignment: integer(row.Consignación),
})
const validateStock = (row, label) => {
  const values = stock(row)
  if (values.available + values.reserve + values.transitory + values.consignment !== values.total) {
    throw new Error(`La ecuación de stock no cuadra en ${label}`)
  }
  return values
}

const totalRows = readRows('STOCK TOTAL')
const batchRows = readRows('STOCK CON P')
const serialRows = readRows('STOCK CON S')
const missingUnitCodes = new Set()
const unitCode = (row, sku) => {
  const value = text(row['Cod. U. Medida']).trim()
  if (!value) missingUnitCodes.add(sku)
  return value || null
}
const master = new Map()
for (const row of totalRows) {
  const sku = code(row['Cod. Producto'])
  const descripcion = text(row.Producto).trim()
  if (!sku || !descripcion) throw new Error('STOCK TOTAL contiene un SKU o descripción vacío.')
  validateStock(row, `STOCK TOTAL:${sku}`)
  if (master.has(sku)) throw new Error(`STOCK TOTAL contiene SKU duplicado: ${sku}`)
  master.set(sku, { codigo: sku, descripcion })
}
if (master.size !== 2453) throw new Error(`STOCK TOTAL esperado=2453, actual=${master.size}`)

const references = []
const referenceKeys = new Set()
const addReference = (item) => {
  const key = `${item.codigo}\u001f${item.reference_value ?? ''}`
  if (referenceKeys.has(key)) throw new Error(`Referencia duplicada: ${item.codigo}`)
  referenceKeys.add(key)
  references.push(item)
}
for (const row of totalRows) {
  const sku = code(row['Cod. Producto'])
  const values = validateStock(row, `STOCK TOTAL:${sku}`)
  if (control(sku) !== 'LEGACY' || (values.total === 0 && values.available === 0)) continue
  const unit = unitCode(row, sku)
  addReference({ codigo: sku, reference_value: null, quantity: values.total, available_quantity: values.available, unit_code: unit, expiration_date: null })
}

const missingBatch = []
for (const row of batchRows) {
  const sku = code(row['Cod. Producto'])
  const values = validateStock(row, `STOCK CON P:${sku}`)
  if (!master.has(sku)) throw new Error(`SKU de partida ausente del maestro: ${sku}`)
  if (control(sku) !== 'PARTIDA') continue
  const batch = text(row['Partida / Talla']).trim()
  if (!batch) {
    if (values.total > 0) missingBatch.push({ codigo: sku, quantity: values.total })
    continue
  }
  const unit = unitCode(row, sku)
  if (values.total !== 0 || values.available !== 0) addReference({ codigo: sku, reference_value: batch, quantity: values.total, available_quantity: values.available, unit_code: unit, expiration_date: date(row['Fecha Venc']) })
}
if (missingBatch.length !== 20 || missingBatch.reduce((total, row) => total + row.quantity, 0) !== 353) {
  throw new Error(`Warning de partida no coincide: sku=${missingBatch.length}; unidades=${missingBatch.reduce((total, row) => total + row.quantity, 0)}`)
}

const series = new Set()
for (const row of serialRows) {
  const sku = code(row['Cod. Producto'])
  const values = validateStock(row, `STOCK CON S:${sku}`)
  if (!master.has(sku)) throw new Error(`SKU de serie ausente del maestro: ${sku}`)
  if (control(sku) !== 'SERIAL') continue
  const serial = text(row.Serie).trim()
  if (!serial) {
    if (values.total > 0) throw new Error(`Serie obligatoria ausente para ${sku}`)
    continue
  }
  if (series.has(serial)) throw new Error(`Serie duplicada: ${serial}`)
  series.add(serial)
  const unit = unitCode(row, sku)
  addReference({ codigo: sku, reference_value: serial, quantity: values.total, available_quantity: values.available, unit_code: unit, expiration_date: null })
}
if (series.size !== 1679) throw new Error(`Series esperadas=1679, actual=${series.size}`)

const masterItems = [...master.values()]
const source = `SOFTLAND_RP_REAL;FILE=${expected.fileName};WARNINGS=PARTIDA_MISSING_POSITIVE:20/353,UOM_MISSING:${missingUnitCodes.size},EXPIRY_OUTLIERS:1931-1932`
const asBase64 = (value) => Buffer.from(JSON.stringify(value), 'utf8').toString('base64')
const sql = `begin;
do $bootstrap$
declare v_actor uuid;
begin
  select p.user_id into v_actor
  from public.profiles p
  join auth.users u on u.id=p.user_id
  where lower(u.email)='metalfilt@gmail.com'
    and p.role='ADMIN'
    and p.active
  limit 1;
  if v_actor is null then raise exception 'QA_ADMIN_PROFILE_NOT_AVAILABLE'; end if;
  perform set_config('request.jwt.claim.sub',v_actor::text,true);
end;
$bootstrap$;
set local role authenticated;
do $import$
declare
  v_actor uuid:=auth.uid();
  v_inventory uuid;
begin
  if v_actor is null then raise exception 'QA_ADMIN_CONTEXT_REQUIRED'; end if;
  if exists(select 1 from public.inventories where name='QA-RP-REAL-20260927') then raise exception 'QA_RP_REAL_INVENTORY_ALREADY_EXISTS'; end if;
  insert into public.inventories(name,status,created_by)
  values('QA-RP-REAL-20260927','BORRADOR',v_actor)
  returning id into v_inventory;
  perform * from public.import_inventory_master(v_inventory,convert_from(decode('${asBase64(masterItems)}','base64'),'utf8')::jsonb,'${source}','${sha256}');
  perform * from public.import_inventory_system_reference(v_inventory,convert_from(decode('${asBase64(references)}','base64'),'utf8')::jsonb,'${source}','${sha256}');
  perform public.prepare_inventory(v_inventory);
  perform public.open_inventory(v_inventory);
end;
$import$;
commit;
select i.id,i.name,i.status,
       (select row_count from public.inventory_master_metadata m where m.inventory_id=i.id) as master_rows,
       (select row_count from public.inventory_system_reference_metadata r where r.inventory_id=i.id) as reference_rows,
       (select count(*) from public.inventory_system_reference_items r where r.inventory_id=i.id and r.reference_type='SERIAL') as serial_rows,
       (select count(*) from public.inventory_system_reference_items r where r.inventory_id=i.id and r.reference_type='PARTIDA') as batch_rows
from public.inventories i where i.name='QA-RP-REAL-20260927';
`

const tempDirectory = mkdtempSync(join(tmpdir(), 'inven3-qa-rp-import-'))
const sqlPath = join(tempDirectory, 'import.sql')
const supabaseCli = process.platform === 'win32'
  ? join(process.env.APPDATA ?? '', 'npm', 'node_modules', 'supabase', 'dist', 'supabase.js')
  : 'supabase'
if (process.platform === 'win32' && !existsSync(supabaseCli)) throw new Error('No se encontró el CLI de Supabase.')
try {
  writeFileSync(sqlPath, sql, { encoding: 'utf8', mode: 0o600 })
  const result = process.platform === 'win32'
    ? execFileSync(process.execPath, [supabaseCli, 'db', 'query', '--linked', '--output-format', 'json', '--file', sqlPath], {
      cwd: process.cwd(), encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'], maxBuffer: 8 * 1024 * 1024,
    })
    : execFileSync(supabaseCli, ['db', 'query', '--linked', '--output-format', 'json', '--file', sqlPath], {
    cwd: process.cwd(), encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'], maxBuffer: 8 * 1024 * 1024,
  })
  process.stdout.write(result)
  console.log(JSON.stringify({
    status: 'QA_RP_REAL_IMPORT_PASS', inventory: 'QA-RP-REAL-20260927', source_sha256: sha256,
    master_rows: masterItems.length, reference_rows: references.length, serial_rows: series.size,
    missing_batch_warning_sku: missingBatch.length, missing_batch_warning_units: 353, missing_unit_code_sku: missingUnitCodes.size,
  }))
} finally {
  rmSync(tempDirectory, { recursive: true, force: true })
}
