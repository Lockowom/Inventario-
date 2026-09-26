import { createHash, randomUUID } from 'node:crypto'
import process from 'node:process'
import { createClient } from '@supabase/supabase-js'
import * as XLSX from '@e965/xlsx'

const EXPECTED_PROJECT_REF = 'uazunvlxlszdyweddxtb'
const DEFAULT_ANALYST_EMAIL = 'qa-analista@inven3-qa.test'
const DEFAULT_INVENTORY_ID = '21ac9823-3153-4502-8fe0-285ff79e9762'
const DEFAULT_CUT_ID = '99ab5613-ad5d-455d-a179-ed8f3e6f4688'
const RP_HEADERS = ['CODIGO', 'SERIE', 'PARTIDA', 'PIEZA DEL PRODUCTO', 'FECHA DE VENCIMIENTO', 'Talla del producto', 'Color del Producto', 'Cantidad Contada', 'DESCRIPCION']

function required(name) {
  const value = process.env[name]?.trim()
  if (!value) throw new Error(`Missing required environment variable: ${name}`)
  return value
}

function assert(condition, message) {
  if (!condition) throw new Error(message)
}

function validateProject(url) {
  const parsed = new globalThis.URL(url)
  assert(parsed.protocol === 'https:', 'F9B QA URL must use HTTPS.')
  assert(parsed.hostname === `${EXPECTED_PROJECT_REF}.supabase.co`, 'Refusing to run outside the approved INVEN3-QA project.')
}

function validateWorkbook(bytes) {
  const book = XLSX.read(bytes, { type: 'array', cellDates: true, cellFormula: true })
  assert(book.SheetNames.length === 1 && book.SheetNames[0] === 'INVENTARIO', 'RP workbook must contain only INVENTARIO.')
  const sheet = book.Sheets.INVENTARIO
  assert(Boolean(sheet), 'RP workbook is missing INVENTARIO.')
  const values = XLSX.utils.sheet_to_json(sheet, { header: 1, raw: true, defval: null })
  assert(JSON.stringify(values[0]) === JSON.stringify(RP_HEADERS), 'RP headers do not match the contract.')
  assert(values.length === 4, 'F9B RP fixture must contain exactly 3 data rows.')

  const expected = [
    ['000123S', 'QA-SERIAL-0001', null, null, 'M', 'VERDE', 1],
    ['000725P', null, '00725', '001234', 'L', 'AZUL', 1],
    ['001234', null, null, null, null, null, 2],
  ]

  expected.forEach((want, index) => {
    const row = values[index + 1]
    assert(row?.[0] === want[0], `RP row ${index + 1} code mismatch.`)
    assert(row?.[1] === want[1], `RP row ${index + 1} serial mismatch.`)
    assert(row?.[2] === want[2], `RP row ${index + 1} batch mismatch.`)
    assert(row?.[3] === want[3], `RP row ${index + 1} product-piece mismatch.`)
    assert(row?.[5] === want[4], `RP row ${index + 1} size mismatch.`)
    assert(row?.[6] === want[5], `RP row ${index + 1} color mismatch.`)
    assert(row?.[7] === want[6], `RP row ${index + 1} quantity mismatch.`)
  })

  assert(['n', 'd'].includes(sheet.E2?.t ?? ''), 'SERIAL expiration must be a real Excel date.')
  assert(['n', 'd'].includes(sheet.E3?.t ?? ''), 'PARTIDA expiration must be a real Excel date.')
  assert(values[3]?.[4] === null, 'LEGACY expiration must be blank.')
  for (const cell of Object.values(sheet)) {
    if (typeof cell === 'object' && cell && 'f' in cell) throw new Error('RP workbook must not contain formulas.')
  }
}

async function main() {
  const url = required('VITE_SUPABASE_URL')
  const anonKey = required('VITE_SUPABASE_ANON_KEY')
  const password = required('F9B_QA_ANALYST_PASSWORD')
  const email = (process.env.F9B_QA_ANALYST_EMAIL?.trim() || DEFAULT_ANALYST_EMAIL).toLowerCase()
  const inventoryId = process.env.F9B_INVENTORY_ID?.trim() || DEFAULT_INVENTORY_ID
  const cutId = process.env.F9B_CUT_ID?.trim() || DEFAULT_CUT_ID
  validateProject(url)

  const supabase = createClient(url, anonKey, { auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false } })
  try {
    const login = await supabase.auth.signInWithPassword({ email, password })
    assert(!login.error && Boolean(login.data.session), 'QA ANALYST authentication failed.')

    const user = await supabase.auth.getUser()
    assert(!user.error && user.data.user?.email?.toLowerCase() === email, 'Authenticated QA identity does not match the requested analyst.')

    const profile = await supabase.from('profiles').select('user_id,display_name,role,active').eq('user_id', user.data.user.id).single()
    assert(!profile.error && profile.data?.active === true, 'QA ANALYST profile is not active.')
    assert(['ANALISTA', 'ADMIN'].includes(profile.data?.role), 'QA session is not allowed to manage cuts.')

    const before = await supabase.rpc('list_inventory_cuts_v2', { p_inventory_id: inventoryId, p_limit: 50, p_before_cut_number: null })
    assert(!before.error, 'Unable to read QA cuts before generation.')
    const targetBefore = (before.data ?? []).find((cut) => cut.id === cutId)
    assert(Boolean(targetBefore), 'Approved QA cut was not found.')

    const generation = await supabase.functions.invoke('generate-cut-rp-xlsx', { body: { cutId, requestId: randomUUID() } })
    assert(!generation.error && !generation.data?.error, 'Remote RP generation failed.')

    const after = await supabase.rpc('list_inventory_cuts_v2', { p_inventory_id: inventoryId, p_limit: 50, p_before_cut_number: null })
    assert(!after.error, 'Unable to read QA cuts after generation.')
    const targetAfter = (after.data ?? []).find((cut) => cut.id === cutId)
    assert(Boolean(targetAfter), 'Approved QA cut disappeared after generation.')
    assert(targetAfter.status === 'READY', 'QA cut did not reach READY.')
    assert(typeof targetAfter.file_hash === 'string' && /^[a-f0-9]{64}$/i.test(targetAfter.file_hash), 'QA cut is missing a valid SHA-256.')
    assert(Number.isInteger(targetAfter.size_bytes) && targetAfter.size_bytes > 0, 'QA cut is missing a valid file size.')

    const download = await supabase.functions.invoke('download-cut-rp-xlsx', { body: { cutId } })
    assert(!download.error && !download.data?.error && typeof download.data?.signedUrl === 'string', 'Signed RP download could not be prepared.')

    const response = await globalThis.fetch(download.data.signedUrl, { redirect: 'follow' })
    assert(response.ok, 'Signed RP download failed.')
    const bytes = new Uint8Array(await response.arrayBuffer())
    const sha256 = createHash('sha256').update(bytes).digest('hex')
    assert(bytes.byteLength === targetAfter.size_bytes, 'Downloaded RP size does not match official metadata.')
    assert(sha256 === targetAfter.file_hash, 'Downloaded RP SHA-256 does not match official metadata.')
    validateWorkbook(bytes)

    globalThis.console.log(JSON.stringify({
      result: 'F9B_REMOTE_RP_PASS',
      projectRef: EXPECTED_PROJECT_REF,
      inventoryId,
      cutId,
      cutNumber: targetAfter.cut_number,
      status: targetAfter.status,
      fileName: targetAfter.file_name,
      sha256,
      sizeBytes: bytes.byteLength,
      rows: targetAfter.record_count,
    }))
  } finally {
    await supabase.auth.signOut().catch(() => undefined)
  }
}

main().catch((error) => {
  const message = error instanceof Error ? error.message : 'F9B remote RP certification failed safely.'
  globalThis.console.error(`F9B_REMOTE_RP_FAIL: ${message}`)
  process.exitCode = 1
})
