/* global process, console */
import { randomUUID } from 'node:crypto'
import { createClient } from '@supabase/supabase-js'

const url = process.env.API_URL
const anonKey = process.env.ANON_KEY
const serviceRoleKey = process.env.SERVICE_ROLE_KEY
if (!url || !anonKey || !serviceRoleKey) throw new Error('Local Supabase status variables are required.')

const email = `phase4-${randomUUID()}@example.invalid`
const password = `P4-${randomUUID()}-safe`
const anon = createClient(url, anonKey)
const signUp = await anon.auth.signUp({ email, password })
if (signUp.error || !signUp.data.user || !signUp.data.session) throw new Error(`Cannot create local test user: ${signUp.error?.message ?? 'missing session'}`)
const userId = signUp.data.user.id
const service = createClient(url, serviceRoleKey)
const inventoryId = randomUUID()
const startedAt = Date.now()

async function must(result, label) {
  if (result.error) throw new Error(`${label}: ${result.error.message}`)
  return result.data
}

await must(await service.from('profiles').insert({ user_id: userId, display_name: 'Phase 4 REST harness', role: 'CONTADOR', active: true }), 'create profile')
const now = new Date().toISOString()
await must(await service.from('inventories').insert({
  id: inventoryId, name: `PHASE4_REST_${randomUUID()}`, status: 'ABIERTO', created_by: userId,
  prepared_at: now, prepared_by: userId, opened_at: now, opened_by: userId,
}), 'create open inventory')
await must(await service.from('inventory_assignments').insert({ inventory_id: inventoryId, user_id: userId, assigned_by: userId, active: true }), 'assign counter')
await must(await service.from('inventory_master_items').insert({ inventory_id: inventoryId, codigo: 'SKU001', descripcion: 'Harness SKU', control_type: 'LEGACY', source: 'TEST', created_by: userId }), 'create master')

const client = createClient(url, anonKey, { global: { headers: { Authorization: `Bearer ${signUp.data.session.access_token}` } } })
const deviceWorkers = Array.from({ length: 47 }, async (_, deviceIndex) => {
  const deviceId = randomUUID()
  await must(await client.rpc('register_sync_device', { p_device_id: deviceId, p_platform: 'WEB', p_app_version: 'phase4-ci', p_device_label: 'INVEN3 WEB CI' }), `register device ${deviceIndex}`)
  const records = Array.from({ length: 50 }, (_, recordIndex) => ({
    client_count_id: randomUUID(), ubicacion: `F-32-${String((recordIndex % 50) + 1).padStart(2, '0')}`,
    codigo: 'SKU001', cantidad_contada: 1, captured_at: '2026-09-17T12:00:00.000Z',
  }))
  const batches = [records.slice(0, 20), records.slice(20, 40), records.slice(40, 50)]
  // Every worker is concurrent; each device preserves its operational 20/20/10 order.
  for (const [batchIndex, recordsBatch] of batches.entries()) {
    const data = await must(await client.rpc('sync_counts', { p_inventory_id: inventoryId, p_device_id: deviceId, p_platform: 'WEB', p_app_version: 'phase4-ci', p_device_label: 'INVEN3 WEB CI', p_records: recordsBatch }), `accept device ${deviceIndex} batch ${batchIndex}`)
    if (data.length !== recordsBatch.length || data.some((row) => row.result_status !== 'ACCEPTED' || !row.server_count_id || !row.received_at)) throw new Error(`Device ${deviceIndex} batch ${batchIndex} did not receive exactly one complete ACCEPTED acknowledgement per record.`)
  }
  return { deviceId, batches }
})
const devices = await Promise.all(deviceWorkers)
await Promise.all(devices.map(async ({ deviceId, batches }, deviceIndex) => {
  for (const [batchIndex, recordsBatch] of batches.entries()) {
    const data = await must(await client.rpc('sync_counts', { p_inventory_id: inventoryId, p_device_id: deviceId, p_platform: 'WEB', p_app_version: 'phase4-ci', p_device_label: 'INVEN3 WEB CI', p_records: recordsBatch }), `replay device ${deviceIndex} batch ${batchIndex}`)
    if (data.length !== recordsBatch.length || data.some((row) => row.result_status !== 'ALREADY_ACCEPTED')) throw new Error(`Replay device ${deviceIndex} batch ${batchIndex} was not idempotent.`)
  }
}))

const expected = 47 * 50
const countResult = await service.from('count_records').select('*', { count: 'exact', head: true }).eq('inventory_id', inventoryId)
if (countResult.error) throw new Error(`count server records: ${countResult.error.message}`)
if (countResult.count !== expected) throw new Error(`Expected ${expected} exactly-once server records, got ${countResult.count}.`)

// Fase 6 remains a local REST integration: an assigned analyst snapshots the
// 47-device workload while a late batch is accepted. The server's inventory
// lock decides which snapshot owns the late rows; no client-side ordering is
// assumed.
const analystEmail = `phase6-analyst-${randomUUID()}@example.invalid`
const analystPassword = `P6-${randomUUID()}-safe`
const analystCreated = await service.auth.admin.createUser({ email: analystEmail, password: analystPassword, email_confirm: true })
if (analystCreated.error || !analystCreated.data.user) throw new Error(`create Fase 6 analyst: ${analystCreated.error?.message ?? 'missing user'}`)
const analystId = analystCreated.data.user.id
await must(await service.from('profiles').insert({ user_id: analystId, display_name: 'Phase 6 REST analyst', role: 'ANALISTA', active: true }), 'create analyst profile')
await must(await service.from('inventory_assignments').insert({ inventory_id: inventoryId, user_id: analystId, assigned_by: userId, active: true }), 'assign analyst')
const analystAnon = createClient(url, anonKey)
const analystLogin = await analystAnon.auth.signInWithPassword({ email: analystEmail, password: analystPassword })
if (analystLogin.error || !analystLogin.data.session) throw new Error(`sign in Fase 6 analyst: ${analystLogin.error?.message ?? 'missing session'}`)
const analyst = createClient(url, anonKey, { global: { headers: { Authorization: `Bearer ${analystLogin.data.session.access_token}` } } })
const firstRequest = randomUUID()
const cutResult = await must(await analyst.rpc('create_cut', { p_inventory_id: inventoryId, p_request_id: firstRequest }), 'create first cut')
if (cutResult.record_count !== expected || cutResult.status !== 'SNAPSHOT_CREATED') throw new Error(`First cut must snapshot ${expected} records exactly once.`)
const replay = await must(await analyst.rpc('create_cut', { p_inventory_id: inventoryId, p_request_id: firstRequest }), 'replay first cut')
if (replay.id !== cutResult.id || replay.cut_number !== cutResult.cut_number) throw new Error('Cut request_id replay did not return the original cut.')
const lateDevice = devices[0]?.deviceId
if (!lateDevice) throw new Error('Missing first device')
const lateRecords = Array.from({ length: 20 }, (_, index) => ({ client_count_id: randomUUID(), ubicacion: `F-33-${String(index + 1).padStart(2, '0')}`, codigo: 'SKU001', cantidad_contada: 1, captured_at: '2026-09-17T13:00:00.000Z' }))
const lateAccepted = await must(await client.rpc('sync_counts', { p_inventory_id: inventoryId, p_device_id: lateDevice, p_platform: 'WEB', p_app_version: 'phase6-ci', p_device_label: 'INVEN3 WEB CI', p_records: lateRecords }), 'accept late records')
if (lateAccepted.some((row) => row.result_status !== 'ACCEPTED')) throw new Error('Late records were not accepted.')
const secondCut = await must(await analyst.rpc('create_cut', { p_inventory_id: inventoryId, p_request_id: randomUUID() }), 'create late-arrival cut')
if (secondCut.record_count !== lateRecords.length || secondCut.first_export_seq !== expected + 1 || secondCut.last_export_seq !== expected + lateRecords.length) throw new Error('Late arrival cut has an invalid record count or export sequence range.')
// Race correction against create_cut. The shared inventory lock makes exactly
// one ordering visible: the snapshot receives the corrected value, or the
// correction is rejected because the cut won first.
const correctionRaceRecord = { client_count_id: randomUUID(), ubicacion: 'F-34-01', codigo: 'SKU001', cantidad_contada: 1, captured_at: '2026-09-17T14:00:00.000Z' }
const correctionRaceAccepted = await must(await client.rpc('sync_counts', { p_inventory_id: inventoryId, p_device_id: lateDevice, p_platform: 'WEB', p_app_version: 'phase6-ci', p_device_label: 'INVEN3 WEB CI', p_records: [correctionRaceRecord] }), 'accept correction race record')
const correctionRaceId = correctionRaceAccepted[0]?.server_count_id
if (!correctionRaceId) throw new Error('Missing server id for correction race record.')
const correctionRaceRequest = randomUUID()
const [raceCutResult, raceCorrectionResult] = await Promise.all([
  analyst.rpc('create_cut', { p_inventory_id: inventoryId, p_request_id: correctionRaceRequest }),
  client.rpc('correct_uncut_count', { p_count_record_id: correctionRaceId, p_physical_payload: { ubicacion: 'F-34-01', codigo: 'SKU001', cantidad_contada: 9 }, p_reason: 'REST concurrency verification' }),
])
if (raceCutResult.error || !raceCutResult.data) throw new Error(`Concurrent cut failed: ${raceCutResult.error?.message ?? 'missing result'}`)
const raceItems = await must(await analyst.rpc('get_cut_items', { p_cut_id: raceCutResult.data.id, p_limit: 100, p_after_export_seq: null }), 'read correction race snapshot')
const raceSnapshot = raceItems.find((item) => item.count_record_id === correctionRaceId)?.snapshot
if (!raceSnapshot) throw new Error('Correction race record is absent from its cut snapshot.')
const expectedRaceQuantity = raceCorrectionResult.error ? 1 : 9
if (raceSnapshot.cantidad_contada !== expectedRaceQuantity) throw new Error('Correction/cut race produced a mixed physical snapshot.')
// Two distinct request IDs against one remaining row cannot overlap. One call
// creates the next cut; the other sees an empty eligible set and fails safely.
const cutRaceRecord = { client_count_id: randomUUID(), ubicacion: 'F-34-02', codigo: 'SKU001', cantidad_contada: 1, captured_at: '2026-09-17T14:01:00.000Z' }
const cutRaceAccepted = await must(await client.rpc('sync_counts', { p_inventory_id: inventoryId, p_device_id: lateDevice, p_platform: 'WEB', p_app_version: 'phase6-ci', p_device_label: 'INVEN3 WEB CI', p_records: [cutRaceRecord] }), 'accept double-cut race record')
if (!cutRaceAccepted[0]?.server_count_id) throw new Error('Missing server id for double-cut race record.')
const cutRaceResults = await Promise.all([analyst.rpc('create_cut', { p_inventory_id: inventoryId, p_request_id: randomUUID() }), analyst.rpc('create_cut', { p_inventory_id: inventoryId, p_request_id: randomUUID() })])
const successfulConcurrentCuts = cutRaceResults.filter((result) => !result.error && result.data)
if (successfulConcurrentCuts.length !== 1 || !cutRaceResults.some((result) => result.error?.message.includes('No existen conteos nuevos'))) throw new Error('Concurrent distinct cut requests did not serialize safely.')
const itemResult = await analyst.from('inventory_cut_items').select('*', { count: 'exact', head: true }).eq('inventory_id', inventoryId)
if (itemResult.error || itemResult.count !== expected + lateRecords.length + 2) throw new Error(`Expected ${expected + lateRecords.length + 2} immutable snapshots with no loss or duplicate.`)
console.log(`Phase 4+6 REST harness passed: ${expected} replayed records across 47 devices, late arrivals, correction/cut serialization and concurrent distinct-cut serialization in ${Date.now() - startedAt}ms.`)
