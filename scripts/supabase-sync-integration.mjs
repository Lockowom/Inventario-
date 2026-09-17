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
const itemResult = await service.from('inventory_cut_items').select('*', { count: 'exact', head: true }).eq('inventory_id', inventoryId)
if (itemResult.error || itemResult.count !== expected + lateRecords.length) throw new Error(`Expected ${expected + lateRecords.length} immutable snapshots with no loss or duplicate.`)
console.log(`Phase 4+6 REST harness passed: ${expected} replayed records across 47 devices, then a ${cutResult.record_count}-row cut and ${secondCut.record_count}-row late-arrival cut in ${Date.now() - startedAt}ms.`)
