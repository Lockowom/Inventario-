import { createHash } from 'node:crypto'
import process from 'node:process'
import * as XLSX from '@e965/xlsx'
import { unzipSync } from 'fflate'
import {
  validateRectificationXlsx,
  validateSnapshot,
  validateTechnicalBackup,
} from '../supabase/functions/_shared/artifact-contract.ts'

const EXPECTED_PROJECT_REF = 'uazunvlxlszdyweddxtb'
const ANALYST_EMAIL = 'qa-analista@inven3-qa.test'
const ADMIN_EMAIL = 'qa-admin@inven3-qa.test'
const INVENTORY_ID = '21ac9823-3153-4502-8fe0-285ff79e9762'
const CUT_ID = '99ab5613-ad5d-455d-a179-ed8f3e6f4688'
const LEGACY_COUNT_ID = 'c8b15d25-0aa3-449d-bdfc-822f9bdbb1de'
const RECTIFICATION_REQUEST_ID = 'f9b40000-0000-4000-8000-000000000801'
const RECTIFICATION_REASON = 'F9B remote QA synthetic rectification'

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

const sha256 = (bytes) => createHash('sha256').update(bytes).digest('hex')
const decoder = new TextDecoder()
const encoder = new TextEncoder()

async function signIn(url, anonKey, email, password, expectedRole) {
  const { createClient } = await import('@supabase/supabase-js')
  const client = createClient(url, anonKey, {
    auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false },
  })
  const login = await client.auth.signInWithPassword({ email, password })
  assert(!login.error && Boolean(login.data.session), `${expectedRole} authentication failed.`)
  const user = await client.auth.getUser()
  assert(!user.error && user.data.user?.email?.toLowerCase() === email, `${expectedRole} authenticated identity mismatch.`)
  const profile = await client.from('profiles').select('user_id,display_name,role,active').eq('user_id', user.data.user.id).single()
  assert(!profile.error && profile.data?.active === true, `${expectedRole} profile is not active.`)
  assert(profile.data?.role === expectedRole, `Expected role ${expectedRole}, received ${profile.data?.role ?? 'unknown'}.`)
  return client
}

async function one(client, table, select, column, value) {
  const result = await client.from(table).select(select).eq(column, value).single()
  if (result.error) throw new Error(`${table}: ${result.error.message}`)
  return result.data
}

async function many(client, table, select, filters = []) {
  let query = client.from(table).select(select)
  for (const [method, column, value] of filters) query = query[method](column, value)
  const result = await query
  if (result.error) throw new Error(`${table}: ${result.error.message}`)
  return result.data ?? []
}

async function invoke(client, functionName, body) {
  const result = await client.functions.invoke(functionName, { body })
  if (result.error || !result.response?.ok || result.data?.error) {
    throw new Error(result.data?.error ?? result.error?.message ?? `${functionName} failed`)
  }
  return result.data
}

async function expectInvokeDenied(client, functionName, body, label) {
  const result = await client.functions.invoke(functionName, { body })
  assert(Boolean(result.error) || !result.response?.ok || Boolean(result.data?.error), `${label} unexpectedly succeeded.`)
}

async function downloadArtifact(client, generation) {
  const reply = await invoke(client, 'download-inventory-artifact', {
    artifact_generation_id: generation.id,
  })
  assert(typeof reply.signedUrl === 'string', `${generation.scope} signed URL missing.`)
  const response = await globalThis.fetch(reply.signedUrl, { redirect: 'follow' })
  assert(response.ok, `${generation.scope} signed download failed with ${response.status}.`)
  const bytes = new Uint8Array(await response.arrayBuffer())
  const hash = sha256(bytes)
  assert(hash === reply.sha256, `${generation.scope} signed-download SHA mismatch.`)
  assert(bytes.byteLength === Number(reply.sizeBytes), `${generation.scope} signed-download size mismatch.`)
  assert(hash === generation.sha256, `${generation.scope} database SHA mismatch.`)
  assert(bytes.byteLength === Number(generation.size_bytes), `${generation.scope} database size mismatch.`)
  return bytes
}

async function generationByScope(client, scope) {
  const result = await client
    .from('artifact_generations')
    .select('*')
    .eq('inventory_id', INVENTORY_ID)
    .eq('scope', scope)
    .maybeSingle()
  if (result.error) throw new Error(`artifact_generations/${scope}: ${result.error.message}`)
  assert(result.data, `Missing ${scope} generation.`)
  return result.data
}

async function generationByRectification(client, rectificationId) {
  const result = await client
    .from('artifact_generations')
    .select('*')
    .eq('rectification_id', rectificationId)
    .eq('scope', 'RECTIFICATION_XLSX')
    .single()
  if (result.error) throw new Error(`RECTIFICATION_XLSX generation: ${result.error.message}`)
  return result.data
}

async function generatedFile(client, generationId) {
  const rows = await many(client, 'generated_files', '*', [['eq', 'artifact_generation_id', generationId]])
  assert(rows.length === 1, `Expected exactly one generated file for ${generationId}, found ${rows.length}.`)
  return rows[0]
}

async function generateReady(client, generation) {
  await invoke(client, 'generate-inventory-artifact', { artifact_generation_id: generation.id })
  const ready = await one(client, 'artifact_generations', '*', 'id', generation.id)
  assert(ready.status === 'READY', `${generation.scope} did not reach READY.`)
  assert(typeof ready.sha256 === 'string' && /^[a-f0-9]{64}$/i.test(ready.sha256), `${generation.scope} missing SHA-256.`)
  assert(Number(ready.size_bytes) > 0, `${generation.scope} missing size.`)
  const file = await generatedFile(client, ready.id)
  assert(file.sha256 === ready.sha256, `${generation.scope} generated_files SHA mismatch.`)
  assert(Number(file.size_bytes) === Number(ready.size_bytes), `${generation.scope} generated_files size mismatch.`)
  return ready
}

async function buildSnapshotSource(client, generation) {
  const inventory = await one(client, 'inventories', '*', 'id', INVENTORY_ID)
  const cut = await one(client, 'inventory_cuts', '*', 'id', CUT_ID)
  const itemRows = await many(client, 'inventory_cut_items', 'snapshot', [['eq', 'cut_id', CUT_ID]])
  const cutItems = itemRows
    .map((row) => row.snapshot)
    .sort((a, b) => Number(a.export_seq) - Number(b.export_seq))
  const cutFileResult = await client
    .from('generated_files')
    .select('id,file_name,storage_path,sha256,size_bytes')
    .eq('cut_id', CUT_ID)
    .eq('file_type', 'CUT_XLSX')
    .single()
  if (cutFileResult.error) throw new Error(`CUT_XLSX source: ${cutFileResult.error.message}`)
  return { generation, inventory, cut, cut_items: cutItems, cut_xlsx: cutFileResult.data }
}

async function buildBackupSource(admin, generation) {
  const inventory = await one(admin, 'inventories', '*', 'id', INVENTORY_ID)

  let cutQuery = admin.from('inventory_cuts').select('*').eq('inventory_id', INVENTORY_ID)
  if (generation.cut_id) cutQuery = cutQuery.eq('id', generation.cut_id)
  const cutResult = await cutQuery
  if (cutResult.error) throw new Error(`backup cuts: ${cutResult.error.message}`)
  const cuts = (cutResult.data ?? []).sort((a, b) => Number(a.cut_number) - Number(b.cut_number))

  let itemQuery = admin.from('inventory_cut_items').select('cut_id,count_record_id,snapshot').eq('inventory_id', INVENTORY_ID)
  if (generation.cut_id) itemQuery = itemQuery.eq('cut_id', generation.cut_id)
  const itemResult = await itemQuery
  if (itemResult.error) throw new Error(`backup cut items: ${itemResult.error.message}`)
  const cutItems = (itemResult.data ?? []).sort((a, b) => {
    const cutCompare = String(a.cut_id).localeCompare(String(b.cut_id))
    return cutCompare || Number(a.snapshot?.export_seq ?? 0) - Number(b.snapshot?.export_seq ?? 0)
  })

  let rectQuery = admin
    .from('cut_rectifications')
    .select('*')
    .eq('inventory_id', INVENTORY_ID)
    .lte('created_at', generation.as_of_at)
  if (generation.cut_id) rectQuery = rectQuery.eq('cut_id', generation.cut_id)
  const rectResult = await rectQuery
  if (rectResult.error) throw new Error(`backup rectifications: ${rectResult.error.message}`)
  const rectifications = (rectResult.data ?? []).sort((a, b) => {
    const cutCompare = String(a.cut_id).localeCompare(String(b.cut_id))
    return cutCompare || Number(a.rectification_number) - Number(b.rectification_number)
  })

  const artifactResult = await admin
    .from('artifact_generations')
    .select('id,artifact_type,scope,status,storage_path,sha256,size_bytes,created_at')
    .eq('inventory_id', INVENTORY_ID)
    .lte('created_at', generation.as_of_at)
    .neq('id', generation.id)
  if (artifactResult.error) throw new Error(`backup artifact history: ${artifactResult.error.message}`)
  const artifacts = (artifactResult.data ?? [])
    .sort((a, b) => String(a.created_at).localeCompare(String(b.created_at)) || String(a.id).localeCompare(String(b.id)))
    .map((row) => ({
      generation_id: row.id,
      artifact_type: row.artifact_type,
      scope: row.scope,
      status: row.status,
      storage_path: row.storage_path,
      sha256: row.sha256,
      size_bytes: row.size_bytes,
    }))

  return {
    generation,
    inventory,
    cuts,
    cut_items: cutItems,
    rectifications,
    artifacts,
  }
}

function validateZipManifest(bytes, expectedScope) {
  const entries = unzipSync(bytes)
  const expectedNames = [
    'manifest.json',
    'inventory.json',
    'cuts.ndjson',
    'cut-items.ndjson',
    'rectifications.ndjson',
    'artifacts.ndjson',
  ]
  assert(JSON.stringify(Object.keys(entries)) === JSON.stringify(expectedNames), 'Technical backup member list mismatch.')
  const manifest = JSON.parse(decoder.decode(entries['manifest.json']))
  assert(manifest.version === 'INVEN3_TECHNICAL_BACKUP_V1', 'Technical backup manifest version mismatch.')
  assert(manifest.scope === expectedScope, 'Technical backup scope mismatch.')
  for (const member of manifest.members ?? []) {
    const data = entries[member.name]
    assert(data, `Missing ZIP member ${member.name}.`)
    assert(sha256(data) === member.sha256, `ZIP member SHA mismatch: ${member.name}.`)
    assert(data.byteLength === Number(member.size_bytes), `ZIP member size mismatch: ${member.name}.`)
  }
  return entries
}

function validateRectificationWorkbookNoFormulas(bytes) {
  const book = XLSX.read(bytes, { type: 'array', cellDates: false, cellFormula: true })
  for (const sheet of Object.values(book.Sheets)) {
    for (const cell of Object.values(sheet ?? {})) {
      if (typeof cell === 'object' && cell && 'f' in cell) throw new Error('RECTIFICATION_XLSX contains formulas.')
    }
  }
}

async function assertLifecycle(client, generationId) {
  const result = await client
    .from('audit_events')
    .select('event_type')
    .eq('entity_type', 'artifact_generation')
    .eq('entity_id', generationId)
  if (result.error) throw new Error(`artifact audit: ${result.error.message}`)
  const events = result.data ?? []
  for (const type of ['ARTIFACT_REQUESTED', 'ARTIFACT_FILE_GENERATED', 'ARTIFACT_VALIDATED', 'ARTIFACT_READY']) {
    assert(events.filter((row) => row.event_type === type).length === 1, `${type} lifecycle count mismatch for ${generationId}.`)
  }
}

async function main() {
  const url = required('VITE_SUPABASE_URL')
  const anonKey = required('VITE_SUPABASE_ANON_KEY')
  const analystPassword = required('F9B_QA_ANALYST_PASSWORD')
  const adminPassword = required('F9B_QA_ADMIN_PASSWORD')
  validateProject(url)

  const analyst = await signIn(url, anonKey, ANALYST_EMAIL, analystPassword, 'ANALISTA')
  const admin = await signIn(url, anonKey, ADMIN_EMAIL, adminPassword, 'ADMIN')

  try {
    const inventory = await one(analyst, 'inventories', '*', 'id', INVENTORY_ID)
    assert(inventory.status === 'ABIERTO', 'QA inventory must remain ABIERTO during F9B remote artifact certification.')
    const cut = await one(analyst, 'inventory_cuts', '*', 'id', CUT_ID)
    assert(cut.status === 'READY' && Number(cut.cut_number) === 1, 'Approved Corte 001 must be READY.')

    // 1) Immutable cut snapshot.
    let snapshot = await generationByScope(analyst, 'CUT_SNAPSHOT')
    snapshot = await generateReady(analyst, snapshot)
    const snapshotBytes = await downloadArtifact(analyst, snapshot)
    await validateSnapshot(snapshotBytes, await buildSnapshotSource(analyst, snapshot))
    const snapshotParsed = JSON.parse(decoder.decode(snapshotBytes))
    assert(snapshotParsed.version === 'INVEN3_SNAPSHOT_V1', 'Snapshot version mismatch.')
    assert(snapshotParsed.cut?.id === CUT_ID, 'Snapshot cut mismatch.')
    assert(snapshotParsed.cut_items?.length === 3, 'Snapshot must preserve the 3-item Corte 001 baseline.')

    // 2) One deterministic synthetic rectification over the LEGACY row.
    const payload = {
      ubicacion: 'A-01-03',
      codigo: '001234',
      serie: null,
      partida: null,
      pieza_producto: null,
      fecha_vencimiento: null,
      talla: null,
      color: null,
      cantidad_contada: 3,
    }
    const rectification = await analyst.rpc('rectify_cut', {
      p_cut_id: CUT_ID,
      p_count_record_id: LEGACY_COUNT_ID,
      p_physical_payload: payload,
      p_reason: RECTIFICATION_REASON,
      p_request_id: RECTIFICATION_REQUEST_ID,
    })
    if (rectification.error) throw new Error(`rectify_cut: ${rectification.error.message}`)
    assert(rectification.data?.id, 'Rectification was not created or recovered.')

    // Verify rectification idempotency without creating another row.
    const rectificationAgain = await analyst.rpc('rectify_cut', {
      p_cut_id: CUT_ID,
      p_count_record_id: LEGACY_COUNT_ID,
      p_physical_payload: payload,
      p_reason: RECTIFICATION_REASON,
      p_request_id: RECTIFICATION_REQUEST_ID,
    })
    if (rectificationAgain.error) throw new Error(`rectify_cut idempotency: ${rectificationAgain.error.message}`)
    assert(rectificationAgain.data?.id === rectification.data.id, 'Rectification idempotency returned a different id.')
    assert(rectificationAgain.data?.idempotent === true, 'Second rectification request was not idempotent.')

    const rectRow = await one(analyst, 'cut_rectifications', '*', 'id', rectification.data.id)
    assert(Number(rectRow.rectification_number) === 1, 'Expected RECTIFICACION 001.')
    assert(Number(rectRow.old_values?.cantidad_contada) === 2, 'Rectification old quantity must preserve baseline 2.')
    assert(Number(rectRow.new_values?.cantidad_contada) === 3, 'Rectification corrected quantity must be 3.')
    assert(rectRow.old_values?.codigo === '001234' && rectRow.new_values?.codigo === '001234', 'LEGACY leading zeros were not preserved.')

    let rectGeneration = await generationByRectification(analyst, rectRow.id)
    rectGeneration = await generateReady(analyst, rectGeneration)
    const rectBytes = await downloadArtifact(analyst, rectGeneration)
    const rectSource = { inventory, cut, rectification: rectRow, generation: rectGeneration }
    validateRectificationXlsx(rectBytes, rectSource)
    validateRectificationWorkbookNoFormulas(rectBytes)
    assert(rectGeneration.file_name?.includes('RECTIFICACION_001'), 'Rectification filename is not stable.')

    // READY invocation must remain idempotent and retain exactly one official generated file.
    await invoke(analyst, 'generate-inventory-artifact', { artifact_generation_id: rectGeneration.id })
    await generatedFile(analyst, rectGeneration.id)

    // 3) CUT_READY_BACKUP is admin-only and must be frozen to the cut READY timestamp.
    let cutBackup = await generationByScope(admin, 'CUT_READY_BACKUP')
    cutBackup = await generateReady(admin, cutBackup)
    const backupBytes = await downloadArtifact(admin, cutBackup)
    const backupSource = await buildBackupSource(admin, cutBackup)
    await validateTechnicalBackup(backupBytes, backupSource)
    const entries = validateZipManifest(backupBytes, 'CUT_READY_BACKUP')
    const rectificationLines = decoder.decode(entries['rectifications.ndjson']).trim().split('\n').filter(Boolean)
    const backedRectifications = rectificationLines.map((line) => JSON.parse(line))
    assert(!backedRectifications.some((row) => row.id === rectRow.id), 'CUT_READY_BACKUP leaked a post-READY rectification.')

    await expectInvokeDenied(
      analyst,
      'download-inventory-artifact',
      { artifact_generation_id: cutBackup.id },
      'ANALISTA technical-backup download',
    )

    const directStorageAttempt = await analyst.storage
      .from('inventory-rp')
      .upload(
        `inventory/${INVENTORY_ID}/f9b-direct-storage-denial.json`,
        encoder.encode('{}'),
        { contentType: 'application/json', upsert: false },
      )
    assert(Boolean(directStorageAttempt.error), 'ANALISTA direct Storage write unexpectedly succeeded.')

    await assertLifecycle(analyst, snapshot.id)
    await assertLifecycle(analyst, rectGeneration.id)
    await assertLifecycle(admin, cutBackup.id)

    const inventoryAfter = await one(analyst, 'inventories', 'id,status', 'id', INVENTORY_ID)
    assert(inventoryAfter.status === 'ABIERTO', 'F9B artifact certification changed the inventory lifecycle state.')

    globalThis.console.log(JSON.stringify({
      result: 'F9B_REMOTE_F8_PASS',
      projectRef: EXPECTED_PROJECT_REF,
      inventoryId: INVENTORY_ID,
      inventoryStatus: inventoryAfter.status,
      cutId: CUT_ID,
      cutStatus: cut.status,
      snapshot: {
        id: snapshot.id,
        status: snapshot.status,
        fileName: snapshot.file_name,
        sha256: snapshot.sha256,
        sizeBytes: Number(snapshot.size_bytes),
      },
      rectification: {
        id: rectRow.id,
        number: rectRow.rectification_number,
        countRecordId: rectRow.count_record_id,
        oldQuantity: rectRow.old_values?.cantidad_contada,
        newQuantity: rectRow.new_values?.cantidad_contada,
        artifactId: rectGeneration.id,
        fileName: rectGeneration.file_name,
        sha256: rectGeneration.sha256,
        sizeBytes: Number(rectGeneration.size_bytes),
      },
      cutReadyBackup: {
        id: cutBackup.id,
        status: cutBackup.status,
        fileName: cutBackup.file_name,
        sha256: cutBackup.sha256,
        sizeBytes: Number(cutBackup.size_bytes),
      },
      checks: {
        signedDownloads: 'PASS',
        shaSizeChain: 'PASS',
        snapshotContract: 'PASS',
        rectificationContract: 'PASS',
        rectificationIdempotency: 'PASS',
        cutReadyBackupContract: 'PASS',
        cutReadyAsOf: 'PASS',
        analystTechnicalBackupDenied: 'PASS',
        directStorageWriteDenied: 'PASS',
        auditLifecycle: 'PASS',
      },
    }))
  } finally {
    await analyst.auth.signOut().catch(() => undefined)
    await admin.auth.signOut().catch(() => undefined)
  }
}

main().catch((error) => {
  const message = error instanceof Error ? error.message : 'F9B remote F8 certification failed safely.'
  globalThis.console.error(`F9B_REMOTE_F8_FAIL: ${message}`)
  process.exitCode = 1
})
