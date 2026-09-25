/* global process, console */
import { randomUUID } from 'node:crypto'
import { createClient } from '@supabase/supabase-js'

const url = process.env.API_URL
const anonKey = process.env.ANON_KEY
const serviceRoleKey = process.env.SERVICE_ROLE_KEY
if (!url || !anonKey || !serviceRoleKey) throw new Error('Local Supabase status variables are required.')

const service = createClient(url, serviceRoleKey)
const reconnect = { users: 47, recordsPerUser: 50, waves: 3, batches: [20, 20, 10], name: 'LOAD_RECONNECT_47X50X3' }
const concurrency = { users: 100, recordsPerUser: 20, waves: 1, batches: [20], name: 'LOAD_CONCURRENCY_100_USERS' }

async function must(result, label) {
  if (result.error) throw new Error(`${label}: ${result.error.message}`)
  return result.data
}

async function createFixture(label) {
  const admin = await service.auth.admin.createUser({ email: `phase9-${label}-admin-${randomUUID()}@example.invalid`, password: `P9-${randomUUID()}-safe`, email_confirm: true })
  if (admin.error || !admin.data.user) throw new Error(`create ${label} admin: ${admin.error?.message ?? 'missing user'}`)
  const adminId = admin.data.user.id
  const inventoryId = randomUUID()
  const now = new Date().toISOString()
  await must(await service.from('profiles').insert({ user_id: adminId, display_name: `Phase 9 ${label} admin`, role: 'ADMIN', active: true }), `insert ${label} admin profile`)
  await must(await service.from('inventories').insert({ id: inventoryId, name: `PHASE9_${label}_${randomUUID()}`, status: 'ABIERTO', created_by: adminId, prepared_at: now, prepared_by: adminId, opened_at: now, opened_by: adminId }), `create ${label} open inventory`)
  await must(await service.from('inventory_master_items').insert({ inventory_id: inventoryId, codigo: 'P9LEGACY', descripcion: `Phase 9 ${label} fixture`, control_type: 'LEGACY', source: 'TEST', created_by: adminId }), `insert ${label} master`)
  return { adminId, inventoryId }
}

async function createActors({ count, inventoryId, adminId, label }) {
  return Promise.all(Array.from({ length: count }, async (_, index) => {
    const email = `phase9-${label}-counter-${index}-${randomUUID()}@example.invalid`
    const password = `P9-${randomUUID()}-safe`
    const created = await service.auth.admin.createUser({ email, password, email_confirm: true })
    if (created.error || !created.data.user) throw new Error(`create ${label} counter ${index}: ${created.error?.message ?? 'missing user'}`)
    const userId = created.data.user.id
    await must(await service.from('profiles').insert({ user_id: userId, display_name: `Phase 9 ${label} counter ${String(index + 1).padStart(3, '0')}`, role: 'CONTADOR', active: true }), `insert ${label} counter profile ${index}`)
    await must(await service.from('inventory_assignments').insert({ inventory_id: inventoryId, user_id: userId, assigned_by: adminId, active: true }), `assign ${label} counter ${index}`)
    const anon = createClient(url, anonKey)
    const login = await anon.auth.signInWithPassword({ email, password })
    if (login.error || !login.data.session) throw new Error(`authenticate ${label} counter ${index}: ${login.error?.message ?? 'missing session'}`)
    const client = createClient(url, anonKey, { global: { headers: { Authorization: `Bearer ${login.data.session.access_token}` } } })
    const deviceId = randomUUID()
    await must(await client.rpc('register_sync_device', { p_device_id: deviceId, p_platform: 'WEB', p_app_version: 'phase-9-ci', p_device_label: `INVEN3 F9 ${label} DEVICE ${String(index + 1).padStart(3, '0')}` }), `register ${label} device ${index}`)
    return { index, userId, deviceId, client }
  }))
}

function buildRecords({ actor, recordCount, wave, clientIds }) {
  return Array.from({ length: recordCount }, (_, recordIndex) => {
    const clientCountId = randomUUID()
    if (clientIds.has(clientCountId)) throw new Error(`Generated duplicate UUID before persistence for ${actor.index}:${recordIndex}.`)
    clientIds.add(clientCountId)
    return {
      client_count_id: clientCountId,
      ubicacion: `F-${String((actor.index % 32) + 1).padStart(2, '0')}-${String(recordIndex + 1).padStart(2, '0')}`,
      codigo: 'P9LEGACY', cantidad_contada: 1,
      captured_at: new Date(Date.UTC(2026, 8, 24, 12, wave, recordIndex)).toISOString(),
    }
  })
}

async function assertRejectedCrossUserDeviceReuse(actors, label) {
  const result = await actors[1].client.rpc('register_sync_device', { p_device_id: actors[0].deviceId, p_platform: 'WEB', p_app_version: 'phase-9-ci', p_device_label: `${label} cross-user reuse must fail` })
  if (!result.error) throw new Error(`${label}: cross-user device reuse was unexpectedly accepted.`)
}

async function verifyPersisted({ inventoryId, actors, expected, recordsPerUser, label }) {
  const persistedCount = await service.from('count_records').select('*', { count: 'exact', head: true }).eq('inventory_id', inventoryId)
  if (persistedCount.error || persistedCount.count !== expected) throw new Error(`${label}: expected ${expected} persisted records, got ${persistedCount.count ?? 'unknown'}.`)
  const persisted = []
  for (let from = 0; from < expected; from += 1000) {
    const page = await must(await service.from('count_records').select('id,client_count_id,user_id,device_id').eq('inventory_id', inventoryId).range(from, Math.min(from + 999, expected - 1)), `${label}: read persisted page ${from}`)
    persisted.push(...page)
  }
  if (persisted.length !== expected) throw new Error(`${label}: expected ${expected} rows across paged verification, got ${persisted.length}.`)
  const duplicateClientCountId = expected - new Set(persisted.map((row) => row.client_count_id)).size
  if (duplicateClientCountId !== 0) throw new Error(`${label}: persisted client_count_id values are not unique.`)
  if (new Set(persisted.map((row) => row.device_id)).size !== actors.length) throw new Error(`${label}: persisted records do not retain exactly one authorized device per actor.`)
  const actorByDevice = new Map(actors.map((actor) => [actor.deviceId, actor]))
  let crossUserDeviceOwnership = 0
  for (const row of persisted) {
    const actor = actorByDevice.get(row.device_id)
    if (!actor || row.user_id !== actor.userId) crossUserDeviceOwnership += 1
  }
  for (const actor of actors) {
    const rows = persisted.filter((row) => row.user_id === actor.userId)
    if (rows.length !== recordsPerUser) throw new Error(`${label}: user ${actor.index} persisted ${rows.length} records instead of ${recordsPerUser}.`)
    if (rows.some((row) => row.device_id !== actor.deviceId)) crossUserDeviceOwnership += 1
  }
  if (crossUserDeviceOwnership !== 0) throw new Error(`${label}: cross-user device ownership persisted for ${crossUserDeviceOwnership} rows.`)
  return { duplicate_client_count_id: duplicateClientCountId, cross_user_device_ownership: crossUserDeviceOwnership }
}

async function runScenario(config) {
  const startedAt = Date.now()
  const { adminId, inventoryId } = await createFixture(config.name)
  const actors = await createActors({ count: config.users, inventoryId, adminId, label: config.name })
  await assertRejectedCrossUserDeviceReuse(actors, config.name)
  const clientIds = new Set()
  let confirmed = 0
  let rejected = 0
  let failed = 0
  let retries = 0

  for (let wave = 1; wave <= config.waves; wave += 1) {
    await Promise.all(actors.map(async (actor) => {
      const records = buildRecords({ actor, recordCount: config.recordsPerUser, wave, clientIds })
      let offset = 0
      for (const size of config.batches) {
        const batch = records.slice(offset, offset + size)
        offset += size
        const acknowledgement = await must(await actor.client.rpc('sync_counts', {
          p_inventory_id: inventoryId, p_device_id: actor.deviceId, p_platform: 'WEB', p_app_version: 'phase-9-ci',
          p_device_label: `INVEN3 F9 ${config.name} DEVICE ${String(actor.index + 1).padStart(3, '0')}`, p_records: batch,
        }), `${config.name}: wave ${wave} device ${actor.index} batch ${size}`)
        if (acknowledgement.length !== size || acknowledgement.some((row) => row.result_status !== 'ACCEPTED' || !row.server_count_id || !row.received_at)) throw new Error(`${config.name}: wave ${wave} device ${actor.index} did not receive a complete coherent ACK for batch ${size}.`)
        confirmed += acknowledgement.length
      }
    }))
  }

  const expected = config.users * config.recordsPerUser * config.waves
  const integrity = await verifyPersisted({ inventoryId, actors, expected, recordsPerUser: config.recordsPerUser * config.waves, label: config.name })
  const elapsedMs = Date.now() - startedAt
  const metrics = {
    users: config.users, devices: actors.length, records: expected, waves: config.waves, confirmed, rejected, failed,
    duplicate_client_count_id: integrity.duplicate_client_count_id, cross_user_device_ownership: integrity.cross_user_device_ownership,
    retries, elapsed_ms: elapsedMs, records_per_second: Number((expected / (elapsedMs / 1000)).toFixed(2)), rss_bytes: process.memoryUsage().rss,
  }
  console.log(`PASS ${config.name} ${JSON.stringify(metrics)}`)
  return metrics
}

await runScenario(reconnect)
await runScenario(concurrency)
console.log('PHASE_9_LOAD_CERTIFICATION_PASS')
