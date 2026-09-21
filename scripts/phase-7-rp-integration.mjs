/* global process, console, fetch */
import { createHash, randomUUID } from 'node:crypto'
import { URL } from 'node:url'
import { createClient } from '@supabase/supabase-js'
import * as XLSX from '@e965/xlsx'
import { generateRpXlsx, validateRpXlsx } from '../src/domain/cut/rp-xlsx.ts'

const { API_URL: url, ANON_KEY: anonKey, SERVICE_ROLE_KEY: serviceKey } = process.env
if (!url || !anonKey || !serviceKey) throw new Error('Local Supabase status variables are required.')
const service = createClient(url, serviceKey)
const now = () => new Date().toISOString()
const sha = (bytes) => createHash('sha256').update(bytes).digest('hex')
const must = async (result, name) => { if (result.error) throw new Error(`${name}: ${result.error.message}`); return result.data }
const fail = (condition, message) => { if (!condition) throw new Error(message) }

async function user(role, label) {
  const email = `phase7-${label}-${randomUUID()}@example.invalid`; const password = `P7-${randomUUID()}-safe`
  const created = await service.auth.admin.createUser({ email, password, email_confirm: true })
  if (created.error || !created.data.user) throw new Error(`Cannot create ${label}: ${created.error?.message ?? 'missing user'}`)
  await must(service.from('profiles').insert({ user_id: created.data.user.id, display_name: `Phase 7 ${label}`, role, active: true }), `profile ${label}`)
  const authClient = createClient(url, anonKey)
  const login = await authClient.auth.signInWithPassword({ email, password })
  if (login.error || !login.data.user || !login.data.session) throw new Error(`Cannot authenticate ${label}: ${login.error?.message ?? 'missing session'}`)
  return { id: created.data.user.id, label, role, client: authClient, authClient, session: login.data.session, token: login.data.session.access_token }
}

async function preflightActor(actor) {
  const identity = await actor.authClient.auth.getUser(actor.token)
  const returnedId = identity.data.user?.id ?? 'none'
  if (identity.error || returnedId !== actor.id) throw new Error(`Harness authenticated session preflight failed: ${actor.label}; expected user ${actor.id}; auth user ${returnedId}.`)
  const { data: profiles, error } = await actor.authClient.from('profiles').select('user_id,role,active').eq('user_id', actor.id)
  const profile = profiles?.length === 1 ? profiles[0] : null
  if (error || profile?.user_id !== actor.id || profile?.role !== actor.role || profile?.active !== true) {
    throw new Error(`Harness authenticated session preflight failed: ${actor.label}; expected active ${actor.role} profile for ${actor.id}; getUser ${returnedId}; profile visible ${profile ? 'yes' : 'no'}; PostgREST ${error?.code ?? '200'}.`)
  }
}

async function createInventory(creator, requester, label) {
  const id = randomUUID(); const time = now()
  await must(service.from('inventories').insert({ id, name: `P7_${label}_${randomUUID()}`, status: 'ABIERTO', created_by: creator.id, prepared_at: time, prepared_by: creator.id, opened_at: time, opened_by: creator.id }), `inventory ${label}`)
  await must(service.from('inventory_assignments').insert([{ inventory_id: id, user_id: creator.id, assigned_by: creator.id, active: true }, { inventory_id: id, user_id: requester.id, assigned_by: creator.id, active: true }]), `assignments ${label}`)
  await must(service.from('inventory_master_items').insert({ inventory_id: id, codigo: '001234', descripcion: 'RP snapshot description', control_type: 'LEGACY', source: 'TEST', created_by: creator.id }), `master ${label}`)
  const deviceId = randomUUID(); await authenticatedRpc(creator, 'register_sync_device', { p_device_id: deviceId, p_platform: 'WEB', p_app_version: 'phase7-ci', p_device_label: 'INVEN3 CI' })
  return { id, deviceId }
}

async function accept(creator, inventory, fields = {}) {
  await must(service.from('count_records').insert({ client_count_id: randomUUID(), inventory_id: inventory.id, user_id: creator.id, device_id: inventory.deviceId, ubicacion: 'A-01-01', codigo: '001234', cantidad_contada: 1, descripcion: 'RP snapshot description', captured_at: now(), inventory_status_at_receive: 'ABIERTO', captured_after_closed_at: null, ...fields }), 'stage immutable cut fixture')
}

async function makeCut(creator, inventory) { return authenticatedRpc(creator, 'create_cut', { p_inventory_id: inventory.id, p_request_id: randomUUID() }) }
async function cutState(cutId) { return must(await service.from('inventory_cuts').select('id,status,generation_error,generation_request_id,generation_requested_by,file_name,file_hash,inventory_id').eq('id', cutId).single(), 'cut state') }
async function metadata(cutId) { return must(await service.from('generated_files').select('id,cut_id,file_name,storage_path,sha256,size_bytes,created_by').eq('cut_id', cutId).eq('file_type', 'CUT_XLSX').single(), 'file metadata') }
async function maybeMetadata(cutId) { return must(await service.from('generated_files').select('id').eq('cut_id', cutId).eq('file_type', 'CUT_XLSX').maybeSingle(), 'maybe file metadata') }

async function invokeRaw(actor, name, body) {
  const result = await actor.authClient.functions.invoke(name, { body })
  return { response: result.response ?? { ok: false, status: 0 }, data: result.data ?? { error: result.error?.message ?? 'Edge invocation failed' } }
}
async function authenticatedRpc(actor, name, body) {
  const result = await actor.authClient.rpc(name, body)
  if (result.error) throw new Error(`${name}: ${result.error.message}`)
  return result.data
}
async function invoke(actor, name, body) {
  const result = await invokeRaw(actor, name, body)
  if (!result.response.ok) { const state = await cutState(body.cutId); throw new Error(`${name}: ${result.data.error ?? result.response.status}; cut=${state.status}; generator=${state.generation_error ?? 'none'}`) }
  return result.data
}
async function cutRows(actor, cutId) {
  const rows = []; let after = null
  do { const page = await authenticatedRpc(actor, 'get_cut_items', { p_cut_id: cutId, p_limit: 200, p_after_export_seq: after }); rows.push(...page.map((item) => item.snapshot)); after = page.length ? page.at(-1).export_seq : null } while (after !== null)
  return rows
}
async function download(actor, cutId, expected) {
  const response = await invoke(actor, 'download-cut-rp-xlsx', { cutId })
  const signed = new URL(response.signedUrl); const external = new URL(url)
  signed.protocol = external.protocol; signed.host = external.host
  const file = await fetch(signed.toString()); if (!file.ok) throw new Error(`Signed download failed: ${file.status}`)
  const bytes = new Uint8Array(await file.arrayBuffer()); const fileMeta = await metadata(cutId); const state = await cutState(cutId)
  fail(sha(bytes) === fileMeta.sha256 && sha(bytes) === state.file_hash, 'Signed-download SHA does not match official metadata.')
  fail(bytes.byteLength === fileMeta.size_bytes, 'Signed-download size does not match official metadata.')
  validateRpXlsx(bytes, expected)
  return { bytes, fileMeta }
}
async function claim(actor, cutId) { return authenticatedRpc(actor, 'request_cut_file_generation', { p_cut_id: cutId, p_request_id: randomUUID() }) }
async function stageArtifact(actor, cut, rows, target = 'FILE_GENERATED') {
  const ticket = await claim(actor, cut.id); fail(ticket.action === 'GENERATE', `Expected GENERATE, got ${ticket.action}`)
  const state = await cutState(cut.id); const name = `INVEN3_${state.inventory_id.replaceAll('-', '').toUpperCase()}_CORTE_${String(cut.cut_number).padStart(3, '0')}.xlsx`; const path = `inventory/${state.inventory_id}/cuts/${cut.id}/${name}`
  const bytes = generateRpXlsx(rows); const digest = sha(bytes)
  await must(service.storage.from('inventory-rp').upload(path, bytes, { contentType: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet', upsert: false }), 'fixture artifact upload')
  await must(service.rpc('record_cut_file_generated', { p_cut_id: cut.id, p_request_id: ticket.request_id, p_file_name: name, p_storage_path: path, p_sha256: digest, p_size_bytes: bytes.byteLength, p_generator_version: 'phase-7-fixture' }), 'record fixture artifact')
  if (target === 'VALIDATED') await must(service.rpc('mark_cut_file_validated', { p_cut_id: cut.id, p_request_id: ticket.request_id }), 'validate fixture artifact')
  return { ticket, bytes, digest, path }
}
async function scenario(creator, requester, label, fields = {}) { const inventory = await createInventory(creator, requester, label); await accept(creator, inventory, fields); const cut = await makeCut(creator, inventory); return { inventory, cut, rows: await cutRows(requester, cut.id) } }
async function expectEdgeError(actor, cutId, label) { const result = await invokeRaw(actor, 'generate-cut-rp-xlsx', { cutId, requestId: randomUUID() }); fail(!result.response.ok, `${label} unexpectedly succeeded`); const state = await cutState(cutId); fail(state.status === 'ERROR' && Boolean(state.generation_error), `${label} did not end safely in ERROR`); return state }

const started = Date.now()
const creator = await user('ANALISTA', 'creator-a'); const requester = await user('ANALISTA', 'requester-b'); const counter = await user('CONTADOR', 'counter'); const outsider = await user('ANALISTA', 'outsider'); const admin = await user('ADMIN', 'admin')
await Promise.all([creator, requester, counter, outsider, admin].map(preflightActor))

// Seven independent official artifacts from one inventory, generated by B after A created each cut.
const primary = await createInventory(creator, requester, 'seven-cuts')
const official = []
for (let index = 1; index <= 7; index += 1) {
  await accept(creator, primary, index === 1 ? { serie: '00001', partida: '00725', pieza_producto: '0001', fecha_vencimiento: '2027-05-15', talla: 'M', color: 'NEGRO', cantidad_contada: 20 } : index === 2 ? { cantidad_contada: 2 } : { cantidad_contada: index + 2 })
  const cut = await makeCut(creator, primary); const rows = await cutRows(requester, cut.id); const generated = await invoke(requester, 'generate-cut-rp-xlsx', { cutId: cut.id, requestId: randomUUID() })
  fail(generated.status === 'READY', `Official cut ${index} did not reach READY`); const artifact = await download(requester, cut.id, rows); official.push({ cut, rows, ...artifact })
}
fail(new Set(official.map(({ cut }) => cut.id)).size === 7, 'Expected seven different cuts.')
fail(new Set(official.map(({ fileMeta }) => fileMeta.storage_path)).size === 7, 'Expected seven different Storage objects.')
const sequences = official.flatMap(({ rows }) => rows.map((row) => row.export_seq)); fail(new Set(sequences).size === sequences.length, 'export_seq values leaked across cuts.')
for (const entry of official) fail(entry.rows.every((row, index) => row.export_seq === entry.rows[0].export_seq + index), 'Snapshot XLSX was not ordered by export_seq ASC.')
const firstSheet = XLSX.read(official[0].bytes, { type: 'array', cellDates: true }).Sheets.INVENTARIO; const blankSheet = XLSX.read(official[1].bytes, { type: 'array', cellDates: true }).Sheets.INVENTARIO
fail(firstSheet.A2?.v === '001234' && firstSheet.B2?.v === '00001' && firstSheet.C2?.v === '00725', 'Leading zero values were not preserved as text in the official XLSX.')
fail(firstSheet.E2?.z === 'dd-mm-yyyy' && XLSX.SSF.parse_date_code(Number(firstSheet.E2?.v)).d === 15, 'Official XLSX UTC date is not exact.')
for (const ref of ['B2', 'C2', 'D2', 'E2', 'F2', 'G2']) fail(blankSheet[ref] === undefined, `Official XLSX optional field ${ref} is not a true blank.`)

// READY remains an immutable artifact and transition audit remains exactly once after a real retry.
const ready = official[0]; const beforeReady = await metadata(ready.cut.id); const again = await invoke(requester, 'generate-cut-rp-xlsx', { cutId: ready.cut.id, requestId: randomUUID() }); const afterReady = await metadata(ready.cut.id)
fail(again.status === 'READY' && JSON.stringify(beforeReady) === JSON.stringify(afterReady), 'READY retry changed the official artifact.')
const audit = await must(service.from('audit_events').select('event_type').eq('entity_id', ready.cut.id).in('event_type', ['CUT_FILE_GENERATED', 'CUT_FILE_VALIDATED', 'CUT_READY']), 'ready audit')
for (const event of ['CUT_FILE_GENERATED', 'CUT_FILE_VALIDATED', 'CUT_READY']) fail(audit.filter((row) => row.event_type === event).length === 1, `READY audit duplicated ${event}.`)
const readyState = await cutState(ready.cut.id); fail(readyState.generation_requested_by === requester.id && ready.fileMeta.created_by === requester.id, 'Official artifact attribution is not the requesting analyst.')

// Controlled server-side interruptions; each continuation itself re-enters through authenticated Edge.
const noArtifact = await scenario(creator, requester, 'error-no-artifact'); const noArtifactClaim = await claim(requester, noArtifact.cut.id); await must(service.rpc('mark_cut_file_error', { p_cut_id: noArtifact.cut.id, p_request_id: noArtifactClaim.request_id, p_message: 'controlled pre-artifact interruption' }), 'mark pre-artifact error')
fail((await cutState(noArtifact.cut.id)).status === 'ERROR' && (await maybeMetadata(noArtifact.cut.id)) === null, 'Pre-artifact error kept an artifact.')
fail((await invoke(requester, 'generate-cut-rp-xlsx', { cutId: noArtifact.cut.id, requestId: randomUUID() })).status === 'READY', 'Pre-artifact retry did not regenerate.')
const errorArtifact = await scenario(creator, requester, 'error-artifact'); const errorStaged = await stageArtifact(requester, errorArtifact.cut, errorArtifact.rows); await must(service.rpc('mark_cut_file_error', { p_cut_id: errorArtifact.cut.id, p_request_id: errorStaged.ticket.request_id, p_message: 'controlled post-artifact interruption' }), 'mark post-artifact error')
const errorBefore = await metadata(errorArtifact.cut.id); fail((await invoke(requester, 'generate-cut-rp-xlsx', { cutId: errorArtifact.cut.id, requestId: randomUUID() })).status === 'READY', 'ERROR artifact recovery did not reach READY'); const errorAfter = await metadata(errorArtifact.cut.id); fail(JSON.stringify(errorBefore) === JSON.stringify(errorAfter), 'ERROR artifact recovery replaced metadata.')
const fileGenerated = await scenario(creator, requester, 'file-generated'); const fgStaged = await stageArtifact(requester, fileGenerated.cut, fileGenerated.rows); fail((await cutState(fileGenerated.cut.id)).status === 'FILE_GENERATED', 'Fixture did not stop at FILE_GENERATED'); await invoke(requester, 'generate-cut-rp-xlsx', { cutId: fileGenerated.cut.id, requestId: randomUUID() }); fail((await cutState(fileGenerated.cut.id)).status === 'READY' && sha((await download(requester, fileGenerated.cut.id, fileGenerated.rows)).bytes) === fgStaged.digest, 'FILE_GENERATED recovery did not reuse bytes.')
const validated = await scenario(creator, requester, 'validated'); const validatedStaged = await stageArtifact(requester, validated.cut, validated.rows, 'VALIDATED'); await invoke(requester, 'generate-cut-rp-xlsx', { cutId: validated.cut.id, requestId: randomUUID() }); fail((await cutState(validated.cut.id)).status === 'READY' && sha((await download(requester, validated.cut.id, validated.rows)).bytes) === validatedStaged.digest, 'VALIDATED recovery did not reuse bytes.')
const missing = await scenario(creator, requester, 'missing'); const missingStaged = await stageArtifact(requester, missing.cut, missing.rows, 'VALIDATED'); await must(service.storage.from('inventory-rp').remove([missingStaged.path]), 'remove fixture artifact'); await expectEdgeError(requester, missing.cut.id, 'Missing Storage recovery')
const corruptValidated = await scenario(creator, requester, 'corrupt-validated'); const cvStaged = await stageArtifact(requester, corruptValidated.cut, corruptValidated.rows, 'VALIDATED'); await must(service.storage.from('inventory-rp').upload(cvStaged.path, new Uint8Array([1, 2, 3]), { contentType: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet', upsert: true }), 'corrupt validated artifact'); await expectEdgeError(requester, corruptValidated.cut.id, 'Validated corrupt Storage recovery')
const corruptGenerated = await scenario(creator, requester, 'corrupt-file-generated'); const cgStaged = await stageArtifact(requester, corruptGenerated.cut, corruptGenerated.rows); await must(service.storage.from('inventory-rp').upload(cgStaged.path, new Uint8Array([4, 5, 6]), { contentType: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet', upsert: true }), 'corrupt generated artifact'); await expectEdgeError(requester, corruptGenerated.cut.id, 'FILE_GENERATED corrupt Storage recovery')

// Roles use real JWTs. Direct object writes must be denied; only signed Edge downloads cross the boundary.
for (const actor of [counter, outsider]) { const denied = await invokeRaw(actor, 'download-cut-rp-xlsx', { cutId: ready.cut.id }); fail(!denied.response.ok, 'Unauthorized role received a signed URL.') }
await download(admin, ready.cut.id, ready.rows)
for (const [label, client] of [['anon', createClient(url, anonKey)], ['analyst', requester.client]]) {
  const directFile = await client.from('generated_files').select('id').eq('cut_id', ready.cut.id); const directCut = await client.from('inventory_cuts').select('id').eq('id', ready.cut.id)
  fail(Boolean(directFile.error) || directFile.data.length === 0, `Direct generated_files metadata was visible to ${label}.`)
  fail(Boolean(directCut.error) || directCut.data.length === 0, `Direct inventory_cuts metadata was visible to ${label}.`)
}
for (const [label, client] of [['anon', createClient(url, anonKey)], ['counter', counter.client], ['analyst', requester.client], ['admin', admin.client]]) {
  const directPath = `direct-denied/${label}-${randomUUID()}.xlsx`; const inserted = await client.storage.from('inventory-rp').upload(directPath, new Uint8Array([1]), { upsert: false }); const updated = await client.storage.from('inventory-rp').upload(ready.fileMeta.storage_path, new Uint8Array([2]), { upsert: true }); const deleted = await client.storage.from('inventory-rp').remove([ready.fileMeta.storage_path])
  fail(Boolean(inserted.error) && Boolean(updated.error) && Boolean(deleted.error), `Direct Storage write was allowed for ${label}.`)
}

// A real 2,350-row cut runs through Edge, Storage, READY and signed download.
const volume = await createInventory(creator, requester, 'volume-2350'); const volumeStarted = Date.now()
for (let batch = 0; batch < 2350; batch += 20) {
  const records = Array.from({ length: Math.min(20, 2350 - batch) }, (_, offset) => ({ client_count_id: randomUUID(), ubicacion: `F-${String(Math.floor((batch + offset) / 99) + 1).padStart(2, '0')}-${String((batch + offset) % 99 + 1).padStart(2, '0')}`, codigo: '001234', cantidad_contada: 1, captured_at: now() }))
  await must(service.from('count_records').insert(records.map((record) => ({ ...record, inventory_id: volume.id, user_id: creator.id, device_id: volume.deviceId, descripcion: 'RP snapshot description', inventory_status_at_receive: 'ABIERTO', captured_after_closed_at: null }))), 'stage volume fixtures')
}
const volumeCut = await makeCut(creator, volume); const volumeRows = await cutRows(requester, volumeCut.id); fail(volumeRows.length === 2350, 'Volume cut snapshot does not have 2,350 rows.'); await invoke(requester, 'generate-cut-rp-xlsx', { cutId: volumeCut.id, requestId: randomUUID() }); const volumeDownload = await download(requester, volumeCut.id, volumeRows)
const deterministicA = generateRpXlsx(volumeRows); const deterministicB = generateRpXlsx(volumeRows); fail(sha(deterministicA) === sha(deterministicB), 'Pure XLSX generator is not byte deterministic for the same snapshot.')
console.log(`Phase 7 certification passed: 7 official cuts, recovery matrix, role/storage security, and 2,350 Edge→Storage→READY→signed-download rows. Volume ${Date.now() - volumeStarted}ms; total ${Date.now() - started}ms; volume SHA ${sha(volumeDownload.bytes)}.`)
