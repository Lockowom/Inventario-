/* global process, console */
import { randomUUID } from 'node:crypto'
import { createClient } from '@supabase/supabase-js'

const url = process.env.API_URL
const anonKey = process.env.ANON_KEY
const serviceRoleKey = process.env.SERVICE_ROLE_KEY
if (!url || !anonKey || !serviceRoleKey) throw new Error('Local Supabase status variables are required.')

const devicesPerWave = 47
const recordsPerDevice = 50
const waves = 3
const batchSizes = [20, 20, 10]
const expected = devicesPerWave * recordsPerDevice * waves
const startedAt = Date.now()
const service = createClient(url, serviceRoleKey)
const inventoryId = randomUUID()
const allClientIds = new Set()
let confirmed = 0
let rejected = 0
let failed = 0
let retries = 0

async function must(result, label) {
  if (result.error) throw new Error(`${label}: ${result.error.message}`)
  return result.data
}

const admin = await service.auth.admin.createUser({ email: `phase9-admin-${randomUUID()}@example.invalid`, password: `P9-${randomUUID()}-safe`, email_confirm: true })
if (admin.error || !admin.data.user) throw new Error(`create local load admin: ${admin.error?.message ?? 'missing user'}`)
const adminId = admin.data.user.id
const now = new Date().toISOString()
await must(await service.from('profiles').insert({ user_id: adminId, display_name: 'Phase 9 load admin', role: 'ADMIN', active: true }), 'insert load admin profile')
await must(await service.from('inventories').insert({ id: inventoryId, name: `PHASE9_LOAD_${randomUUID()}`, status: 'ABIERTO', created_by: adminId, prepared_at: now, prepared_by: adminId, opened_at: now, opened_by: adminId }), 'create open load inventory')
await must(await service.from('inventory_master_items').insert({ inventory_id: inventoryId, codigo: 'P9LEGACY', descripcion: 'Phase 9 load fixture', control_type: 'LEGACY', source: 'TEST', created_by: adminId }), 'insert load master')

const actors = await Promise.all(Array.from({ length: devicesPerWave }, async (_, index) => {
  const email = `phase9-counter-${index}-${randomUUID()}@example.invalid`
  const password = `P9-${randomUUID()}-safe`
  const created = await service.auth.admin.createUser({ email, password, email_confirm: true })
  if (created.error || !created.data.user) throw new Error(`create counter ${index}: ${created.error?.message ?? 'missing user'}`)
  const userId = created.data.user.id
  await must(await service.from('profiles').insert({ user_id: userId, display_name: `Phase 9 counter ${String(index + 1).padStart(2, '0')}`, role: 'CONTADOR', active: true }), `insert counter profile ${index}`)
  await must(await service.from('inventory_assignments').insert({ inventory_id: inventoryId, user_id: userId, assigned_by: adminId, active: true }), `assign counter ${index}`)
  const anon = createClient(url, anonKey)
  const login = await anon.auth.signInWithPassword({ email, password })
  if (login.error || !login.data.session) throw new Error(`authenticate counter ${index}: ${login.error?.message ?? 'missing session'}`)
  const client = createClient(url, anonKey, { global: { headers: { Authorization: `Bearer ${login.data.session.access_token}` } } })
  const deviceId = randomUUID()
  await must(await client.rpc('register_sync_device', { p_device_id: deviceId, p_platform: 'WEB', p_app_version: 'phase-9-ci', p_device_label: `INVEN3 F9 DEVICE ${String(index + 1).padStart(2, '0')}` }), `register device ${index}`)
  return { index, userId, deviceId, client }
}))

const unauthorizedReuse = await actors[1].client.rpc('register_sync_device', { p_device_id: actors[0].deviceId, p_platform: 'WEB', p_app_version: 'phase-9-ci', p_device_label: 'cross-user reuse must fail' })
if (!unauthorizedReuse.error) throw new Error('Cross-user device reuse was unexpectedly accepted.')

for (let wave = 1; wave <= waves; wave += 1) {
  await Promise.all(actors.map(async ({ client, deviceId, index }) => {
    const records = Array.from({ length: recordsPerDevice }, (_, recordIndex) => {
      const clientCountId = randomUUID()
      if (allClientIds.has(clientCountId)) throw new Error(`Generated duplicate UUID before persistence: ${clientCountId}`)
      allClientIds.add(clientCountId)
      return { client_count_id: clientCountId, ubicacion: `F-${String((index % 32) + 1).padStart(2, '0')}-${String(recordIndex + 1).padStart(2, '0')}`, codigo: 'P9LEGACY', cantidad_contada: 1, captured_at: new Date(Date.UTC(2026, 8, 24, 12, wave, recordIndex)).toISOString() }
    })
    let offset = 0
    for (const size of batchSizes) {
      const batch = records.slice(offset, offset + size)
      offset += size
      const acknowledgement = await must(await client.rpc('sync_counts', { p_inventory_id: inventoryId, p_device_id: deviceId, p_platform: 'WEB', p_app_version: 'phase-9-ci', p_device_label: `INVEN3 F9 DEVICE ${String(index + 1).padStart(2, '0')}`, p_records: batch }), `wave ${wave} device ${index} batch ${size}`)
      if (acknowledgement.length !== size || acknowledgement.some((row) => row.result_status !== 'ACCEPTED' || !row.server_count_id || !row.received_at)) throw new Error(`Wave ${wave} device ${index} did not receive a complete coherent ACK for batch ${size}.`)
      confirmed += acknowledgement.length
    }
  }))
}

const persisted = await service.from('count_records').select('id,client_count_id,user_id,device_id', { count: 'exact' }).eq('inventory_id', inventoryId)
if (persisted.error || persisted.count !== expected || persisted.data?.length !== expected) throw new Error(`Expected ${expected} persisted load records, got ${persisted.count ?? 'unknown'}.`)
if (new Set(persisted.data.map((row) => row.client_count_id)).size !== expected) throw new Error('Persisted client_count_id values are not unique.')
if (new Set(persisted.data.map((row) => row.device_id)).size !== devicesPerWave) throw new Error('Persisted records do not retain exactly one authorized device per actor.')
for (const actor of actors) {
  if (persisted.data.some((row) => row.device_id === actor.deviceId && row.user_id !== actor.userId)) throw new Error(`Cross-user device ownership persisted for device ${actor.deviceId}.`)
}

const elapsedMs = Date.now() - startedAt
const recordsPerSecond = Number((expected / (elapsedMs / 1000)).toFixed(2))
console.log(JSON.stringify({ devices: devicesPerWave, records: expected, waves, confirmed, rejected, failed, duplicates: expected - allClientIds.size, retries, elapsed_ms: elapsedMs, records_per_second: recordsPerSecond, rss_bytes: process.memoryUsage().rss }))
console.log('PHASE_9_LOAD_CERTIFICATION_PASS')
