/* global console, process */
import { randomUUID } from 'node:crypto'
import { createClient } from '@supabase/supabase-js'

const { API_URL: url, ANON_KEY: anonKey, SERVICE_ROLE_KEY: serviceKey } = process.env
if (!url || !anonKey || !serviceKey) throw new Error('Local Supabase status variables are required.')
const service = createClient(url, serviceKey)
const now = () => new Date().toISOString()
const fail = (condition, message) => { if (!condition) throw new Error(message) }
const must = async (result, name) => { const resolved = await result; if (resolved.error) throw new Error(`${name}: ${resolved.error.message}`); return resolved.data }

async function actor(role, label) {
  const email = `phase8-${label}-${randomUUID()}@example.invalid`; const password = `P8-${randomUUID()}-safe`
  const created = await service.auth.admin.createUser({ email, password, email_confirm: true })
  if (created.error || !created.data.user) throw new Error(`Cannot create ${label}: ${created.error?.message ?? 'missing user'}`)
  await must(service.from('profiles').insert({ user_id: created.data.user.id, display_name: `Phase 8 ${label}`, role, active: true }), `profile ${label}`)
  const authClient = createClient(url, anonKey, { auth: { storageKey: `phase8-${label}-${randomUUID()}` } })
  const login = await authClient.auth.signInWithPassword({ email, password })
  if (login.error || !login.data.session) throw new Error(`Cannot authenticate ${label}: ${login.error?.message ?? 'missing session'}`)
  const client = createClient(url, anonKey, { global: { headers: { Authorization: `Bearer ${login.data.session.access_token}` } } })
  return { id: created.data.user.id, role, label, client }
}

async function rpc(actorValue, name, body) {
  const result = await actorValue.client.rpc(name, body)
  if (result.error) throw new Error(`${name}: ${result.error.message}`)
  return result.data
}

async function rpcError(actorValue, name, body, expected) {
  const result = await actorValue.client.rpc(name, body)
  fail(Boolean(result.error) && result.error.message.includes(expected), `${name} expected ${expected}, got ${result.error?.message ?? 'success'}`)
}

async function createInventory(owner, manager, label) {
  const id = randomUUID(); const time = now(); const deviceId = randomUUID()
  await must(service.from('inventories').insert({ id, name: `P8_${label}_${randomUUID()}`, status: 'ABIERTO', created_by: owner.id, prepared_at: time, prepared_by: owner.id, opened_at: time, opened_by: owner.id }), `inventory ${label}`)
  await must(service.from('inventory_assignments').insert([{ inventory_id: id, user_id: owner.id, assigned_by: owner.id }, { inventory_id: id, user_id: manager.id, assigned_by: owner.id }]), `assignments ${label}`)
  await must(service.from('inventory_master_items').insert([
    { inventory_id: id, codigo: '001234', descripcion: 'Legacy F8', control_type: 'LEGACY', source: 'TEST', created_by: owner.id },
    { inventory_id: id, codigo: 'SERIALS', descripcion: 'Serial F8', control_type: 'SERIAL', source: 'TEST', created_by: owner.id },
    { inventory_id: id, codigo: 'BATCHP', descripcion: 'Batch F8', control_type: 'PARTIDA', source: 'TEST', created_by: owner.id },
  ]), `master ${label}`)
  await rpc(owner, 'register_sync_device', { p_device_id: deviceId, p_platform: 'WEB', p_app_version: 'phase8-ci', p_device_label: `P8 ${label}` })
  return { id, deviceId }
}

async function stageCount(owner, inventory, fields) {
  await must(service.from('count_records').insert({
    client_count_id: randomUUID(), inventory_id: inventory.id, user_id: owner.id, device_id: inventory.deviceId,
    ubicacion: 'A-01-01', codigo: '001234', cantidad_contada: 1, descripcion: 'Legacy F8', captured_at: now(),
    inventory_status_at_receive: 'ABIERTO', captured_after_closed_at: null, ...fields,
  }), 'stage F8 count')
}

async function makeReady(owner, manager, inventory) {
  const cut = await rpc(manager, 'create_cut', { p_inventory_id: inventory.id, p_request_id: randomUUID() })
  const claimed = await rpc(manager, 'request_cut_file_generation', { p_cut_id: cut.id, p_request_id: randomUUID() })
  fail(claimed.action === 'GENERATE', `Expected generation ticket, got ${claimed.action}`)
  const fileName = `INVEN3_${inventory.id.replaceAll('-', '').toUpperCase()}_CORTE_${String(cut.cut_number).padStart(3, '0')}.xlsx`
  const path = `inventory/${inventory.id}/cuts/${cut.id}/${fileName}`
  const sha = 'a'.repeat(64)
  await must(service.rpc('record_cut_file_generated', { p_cut_id: cut.id, p_request_id: claimed.request_id, p_file_name: fileName, p_storage_path: path, p_sha256: sha, p_size_bytes: 64, p_generator_version: 'phase8-db' }), 'record F8 fixture artifact')
  await must(service.rpc('mark_cut_file_validated', { p_cut_id: cut.id, p_request_id: claimed.request_id }), 'validate F8 fixture artifact')
  await must(service.rpc('finalize_cut_file', { p_cut_id: cut.id, p_request_id: claimed.request_id }), 'finalize F8 fixture artifact')
  const state = await must(service.from('inventory_cuts').select('id,status,ready_at,generation_request_id,file_hash,file_name,inventory_id').eq('id', cut.id).single(), 'ready cut state')
  fail(state.status === 'READY' && state.ready_at, 'Fixture cut is not READY with ready_at.')
  return state
}

const started = Date.now()
const failures = []
async function scenario(name, action) {
  try { await action(); console.log(`PASS ${name}`) } catch (error) { failures.push({ name, message: error instanceof Error ? error.message : 'Unknown harness error' }); console.error(`FAIL ${name}: ${error instanceof Error ? error.message : 'Unknown harness error'}`) }
}

const owner = await actor('ANALISTA', 'owner')
const manager = await actor('ANALISTA', 'manager')
const counter = await actor('CONTADOR', 'counter')
const outsider = await actor('ANALISTA', 'outsider')
const admin = await actor('ADMIN', 'admin')
const primary = await createInventory(owner, manager, 'primary')
await must(service.from('inventory_assignments').insert({ inventory_id: primary.id, user_id: counter.id, assigned_by: owner.id }), 'counter assignment')
await stageCount(owner, primary, { ubicacion: 'A-01-01', cantidad_contada: 1, serie: '00001', partida: '00725', pieza_producto: '0001', fecha_vencimiento: '2027-05-15', talla: 'M', color: 'NEGRO' })
await stageCount(owner, primary, { ubicacion: 'A-01-02', cantidad_contada: 2 })
const ready = await makeReady(owner, manager, primary)
const cutItems = await rpc(manager, 'get_cut_items', { p_cut_id: ready.id, p_limit: 100, p_after_export_seq: null })
const [recordA, recordB] = cutItems
const originalSnapshot = JSON.stringify(recordA.snapshot)
const originalCount = await must(service.from('count_records').select('cantidad_contada,cut_id,export_seq').eq('id', recordA.count_record_id).single(), 'original count')
const originalFile = await must(service.from('generated_files').select('storage_path,sha256,file_name').eq('cut_id', ready.id).eq('file_type', 'CUT_XLSX').single(), 'original F7 metadata')

await scenario('AUTHORIZATION', async () => {
  const body = { p_cut_id: ready.id, p_count_record_id: recordA.count_record_id, p_physical_payload: { ubicacion: 'B-02-03', codigo: '001234', cantidad_contada: 3 }, p_reason: 'authorization', p_request_id: randomUUID() }
  await rpcError(counter, 'rectify_cut', body, 'Not authorized to rectify cut')
  await rpcError(outsider, 'rectify_cut', { ...body, p_request_id: randomUUID() }, 'Not authorized to rectify cut')
  const hidden = await outsider.client.from('artifact_generations').select('id').eq('inventory_id', primary.id)
  fail(!hidden.error && hidden.data.length === 0, 'Unassigned analyst can see artifact lifecycle rows.')
  const adminMetadata = await admin.client.from('artifact_generations').select('id').eq('inventory_id', primary.id)
  fail(!adminMetadata.error && adminMetadata.data.length === 2, 'ADMIN cannot see protected artifact lifecycle metadata.')
})

await scenario('STATES', async () => {
  const notReadyInventory = await createInventory(owner, manager, 'not-ready'); await stageCount(owner, notReadyInventory, {})
  const notReadyCut = await rpc(manager, 'create_cut', { p_inventory_id: notReadyInventory.id, p_request_id: randomUUID() })
  const [notReadyRecord] = await rpc(manager, 'get_cut_items', { p_cut_id: notReadyCut.id, p_limit: 100, p_after_export_seq: null })
  await rpcError(manager, 'rectify_cut', { p_cut_id: notReadyCut.id, p_count_record_id: notReadyRecord.count_record_id, p_physical_payload: { ubicacion: 'A-01-01', codigo: '001234', cantidad_contada: 2 }, p_reason: 'not ready', p_request_id: randomUUID() }, 'Cut must be READY')
  const closed = await rpc(manager, 'close_inventory', { target_inventory_id: primary.id })
  fail(closed.status === 'CERRADO', 'Inventory did not close.')
  const closedRectification = await rpc(manager, 'rectify_cut', { p_cut_id: ready.id, p_count_record_id: recordB.count_record_id, p_physical_payload: { ubicacion: 'C-03-04', codigo: '001234', cantidad_contada: 4 }, p_reason: 'closed state', p_request_id: randomUUID() })
  fail(closedRectification.rectification_number === 1, 'CERRADO rectification was not accepted.')
  const frozen = await rpc(manager, 'freeze_inventory', { target_inventory_id: primary.id })
  fail(frozen.status === 'CONGELADO', 'Inventory did not freeze.')
  const frozenRectification = await rpc(manager, 'rectify_cut', { p_cut_id: ready.id, p_count_record_id: recordB.count_record_id, p_physical_payload: { ubicacion: 'D-04-05', codigo: '001234', cantidad_contada: 5 }, p_reason: 'frozen state', p_request_id: randomUUID() })
  fail(frozenRectification.rectification_number === 2, 'CONGELADO rectification was not accepted.')
})

await scenario('PHYSICAL_VALIDATION', async () => {
  const base = { p_cut_id: ready.id, p_count_record_id: recordA.count_record_id, p_reason: 'validation' }
  await rpcError(manager, 'rectify_cut', { ...base, p_physical_payload: { ubicacion: 'A-01-01', codigo: '001234', cantidad_contada: 1, descripcion: 'forbidden' }, p_request_id: randomUUID() }, 'UNEXPECTED_PHYSICAL_PAYLOAD_KEY')
  await rpcError(manager, 'rectify_cut', { ...base, p_physical_payload: { ubicacion: 'Z-99-99', codigo: '001234', cantidad_contada: 1 }, p_request_id: randomUUID() }, 'INVALID_LOCATION')
  await rpcError(manager, 'rectify_cut', { ...base, p_physical_payload: { ubicacion: 'A-01-01', codigo: 'SERIALS', cantidad_contada: 2 }, p_request_id: randomUUID() }, 'INVALID_SERIAL')
  await rpcError(manager, 'rectify_cut', { ...base, p_physical_payload: { ubicacion: 'A-01-01', codigo: 'BATCHP', serie: 'x', cantidad_contada: 1 }, p_request_id: randomUUID() }, 'INVALID_BATCH')
  await rpcError(manager, 'rectify_cut', { ...base, p_physical_payload: { ubicacion: 'A-01-01', codigo: 'MISSING', cantidad_contada: 1 }, p_request_id: randomUUID() }, 'UNKNOWN_SKU')
  await rpcError(manager, 'rectify_cut', { ...base, p_physical_payload: { ubicacion: 'A-01-01', codigo: '001234', fecha_vencimiento: '15-05-2027', cantidad_contada: 1 }, p_request_id: randomUUID() }, 'INVALID_DATE')
})

let firstRectification
await scenario('IDEMPOTENCY', async () => {
  const requestId = randomUUID(); const payload = { ubicacion: 'B-02-03', codigo: '001234', serie: '00001', partida: '00725', pieza_producto: '0001', fecha_vencimiento: '2027-05-15', talla: 'M', color: 'NEGRO', cantidad_contada: 3 }
  firstRectification = await rpc(manager, 'rectify_cut', { p_cut_id: ready.id, p_count_record_id: recordA.count_record_id, p_physical_payload: payload, p_reason: '  first decision  ', p_request_id: requestId })
  const replay = await rpc(manager, 'rectify_cut', { p_cut_id: ready.id, p_count_record_id: recordA.count_record_id, p_physical_payload: { cantidad_contada: 3, color: 'NEGRO', talla: 'M', fecha_vencimiento: '2027-05-15', pieza_producto: '0001', partida: '00725', serie: '00001', codigo: '001234', ubicacion: 'B-02-03' }, p_reason: 'first decision', p_request_id: requestId })
  fail(replay.id === firstRectification.id && replay.idempotent === true, 'Canonical retry did not return same rectification.')
  await rpcError(manager, 'rectify_cut', { p_cut_id: ready.id, p_count_record_id: recordA.count_record_id, p_physical_payload: { ...payload, cantidad_contada: 4 }, p_reason: 'first decision', p_request_id: requestId }, 'IDEMPOTENCY_CONFLICT')
  const rectCount = await manager.client.from('cut_rectifications').select('id', { count: 'exact', head: true }).eq('id', firstRectification.id)
  const auditCount = await manager.client.from('audit_events').select('id', { count: 'exact', head: true }).eq('entity_id', firstRectification.id).eq('event_type', 'RECTIFICATION_CREATED')
  fail(!rectCount.error && !auditCount.error && rectCount.count === 1 && auditCount.count === 1, 'Idempotent retry duplicated row or business audit.')
})

await scenario('CROSS_RECORD_CHAIN', async () => {
  const second = await rpc(manager, 'rectify_cut', { p_cut_id: ready.id, p_count_record_id: recordB.count_record_id, p_physical_payload: { ubicacion: 'C-05-06', codigo: '001234', cantidad_contada: 6 }, p_reason: 'B R002', p_request_id: randomUUID() })
  const third = await rpc(manager, 'rectify_cut', { p_cut_id: ready.id, p_count_record_id: recordA.count_record_id, p_physical_payload: { ubicacion: 'F-06-07', codigo: '001234', cantidad_contada: 7 }, p_reason: 'A R003', p_request_id: randomUUID() })
  const first = await must(manager.client.from('cut_rectifications').select('new_values,rectification_number').eq('id', firstRectification.id).single(), 'R001')
  const thirdRow = await must(manager.client.from('cut_rectifications').select('old_values,rectification_number').eq('id', third.id).single(), 'R003')
  fail(second.rectification_number < third.rectification_number && JSON.stringify(thirdRow.old_values) === JSON.stringify(first.new_values), 'R003 did not use R001 effective values for the same record.')
})

await scenario('CONCURRENCY', async () => {
  const outcomes = await Promise.all([
    rpc(manager, 'rectify_cut', { p_cut_id: ready.id, p_count_record_id: recordA.count_record_id, p_physical_payload: { ubicacion: 'G-07-08', codigo: '001234', cantidad_contada: 8 }, p_reason: 'concurrent A', p_request_id: randomUUID() }),
    rpc(manager, 'rectify_cut', { p_cut_id: ready.id, p_count_record_id: recordB.count_record_id, p_physical_payload: { ubicacion: 'H-08-09', codigo: '001234', cantidad_contada: 9 }, p_reason: 'concurrent B', p_request_id: randomUUID() }),
  ])
  fail(outcomes[0].rectification_number !== outcomes[1].rectification_number, 'Concurrent rectifications collided on their global number.')
})

await scenario('IMMUTABILITY', async () => {
  const afterCount = await must(service.from('count_records').select('cantidad_contada,cut_id,export_seq').eq('id', recordA.count_record_id).single(), 'count after rectification')
  const afterSnapshot = (await rpc(manager, 'get_cut_items', { p_cut_id: ready.id, p_limit: 100, p_after_export_seq: null })).find((item) => item.count_record_id === recordA.count_record_id)
  const afterFile = await must(service.from('generated_files').select('storage_path,sha256,file_name').eq('cut_id', ready.id).eq('file_type', 'CUT_XLSX').single(), 'F7 metadata after rectification')
  fail(JSON.stringify(afterCount) === JSON.stringify(originalCount) && JSON.stringify(afterSnapshot.snapshot) === originalSnapshot && JSON.stringify(afterFile) === JSON.stringify(originalFile), 'Rectification mutated immutable F7 evidence.')
})

await scenario('AUTO_RESERVATIONS', async () => {
  const cutReservations = await must(service.from('artifact_generations').select('id,scope,status,as_of_at,requested_by,request_origin').eq('cut_id', ready.id).in('scope', ['CUT_SNAPSHOT', 'CUT_READY_BACKUP']), 'cut reservations')
  fail(cutReservations.length === 2 && cutReservations.every((row) => row.status === 'REQUESTED' && row.as_of_at === ready.ready_at && row.requested_by === manager.id && row.request_origin === 'SYSTEM'), 'READY reservations are not canonical REQUESTED rows.')
  await must(service.rpc('finalize_cut_file', { p_cut_id: ready.id, p_request_id: ready.generation_request_id }), 'idempotent READY finalization')
  const retryReservations = await service.from('artifact_generations').select('id', { count: 'exact', head: true }).eq('cut_id', ready.id).in('scope', ['CUT_SNAPSHOT', 'CUT_READY_BACKUP'])
  fail(!retryReservations.error && retryReservations.count === 2, 'READY retry duplicated reservations.')
  const freezeInventory = await createInventory(owner, manager, 'freeze')
  await rpc(manager, 'close_inventory', { target_inventory_id: freezeInventory.id }); await rpc(manager, 'freeze_inventory', { target_inventory_id: freezeInventory.id })
  const finalBackup = await must(service.from('artifact_generations').select('scope,status,as_of_at,requested_by,request_origin').eq('inventory_id', freezeInventory.id).eq('scope', 'FINAL_FROZEN_BACKUP').single(), 'final frozen backup')
  const frozenState = await must(service.from('inventories').select('frozen_at').eq('id', freezeInventory.id).single(), 'frozen state')
  fail(finalBackup.status === 'REQUESTED' && finalBackup.as_of_at === frozenState.frozen_at && finalBackup.requested_by === manager.id && finalBackup.request_origin === 'SYSTEM', 'Freeze reservation is not canonical.')
  const rectArtifact = await must(service.from('artifact_generations').select('status,request_origin,requested_by').eq('rectification_id', firstRectification.id).eq('scope', 'RECTIFICATION_XLSX').single(), 'rectification artifact reservation')
  fail(rectArtifact.status === 'REQUESTED' && rectArtifact.request_origin === 'SYSTEM' && rectArtifact.requested_by === manager.id, 'Rectification reservation is not canonical.')
})

console.log('PHASE 8B DATABASE CERTIFICATION SUMMARY')
if (failures.length) { failures.forEach(({ name, message }) => console.error(`FAIL ${name}: ${message}`)); throw new Error(`Phase 8B certification has ${failures.length} failing scenario(s).`) }
console.log(`Phase 8B certification passed in ${Date.now() - started}ms.`)
