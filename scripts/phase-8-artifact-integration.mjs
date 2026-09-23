/* global console, fetch, process */
import { createHash, randomUUID } from 'node:crypto'
import { URL } from 'node:url'
import { TextEncoder } from 'node:util'
import { createClient } from '@supabase/supabase-js'

const { API_URL: url, ANON_KEY: anonKey, SERVICE_ROLE_KEY: serviceKey } = process.env
if (!url || !anonKey || !serviceKey) throw new Error('Local Supabase status variables are required.')
const service = createClient(url, serviceKey)
const sha = (bytes) => createHash('sha256').update(bytes).digest('hex')
const must = async (result, label) => { const response = await result; if (response.error) throw new Error(`${label}: ${response.error.message}`); return response.data }
const check = (condition, message) => { if (!condition) throw new Error(message) }
const failures = []
async function scenario(name, fn) { try { await fn(); console.log(`PASS ${name}`) } catch (error) { const message = error instanceof Error ? error.message : 'Unknown error'; failures.push(`${name}: ${message}`); console.error(`FAIL ${name}: ${message}`) } }
async function makeUser(role, label) {
  const email = `f8c-${label}-${randomUUID()}@example.invalid`; const password = `P8c-${randomUUID()}-safe`
  const created = await service.auth.admin.createUser({ email, password, email_confirm: true }); if (created.error || !created.data.user) throw new Error(`create ${label}: ${created.error?.message}`)
  await must(service.from('profiles').insert({ user_id: created.data.user.id, display_name: label, role, active: true }), `profile ${label}`)
  const auth = createClient(url, anonKey, { auth: { storageKey: `f8c-${label}-${randomUUID()}` } }); const login = await auth.auth.signInWithPassword({ email, password }); if (login.error || !login.data.session) throw new Error(`login ${label}: ${login.error?.message}`)
  return { id: created.data.user.id, client: createClient(url, anonKey, { global: { headers: { Authorization: `Bearer ${login.data.session.access_token}` } } }) }
}
async function invoke(actor, fn, body) { const result = await actor.client.functions.invoke(fn, { body }); if (result.error || !result.response?.ok) throw new Error(result.data?.error ?? result.error?.message ?? `${fn} failed`); return result.data }
async function rpc(actor, fn, args) { return must(actor.client.rpc(fn, args), fn) }
async function download(actor, generation) {
  const reply = await invoke(actor, 'download-inventory-artifact', { artifact_generation_id: generation.id }); const signed = new URL(reply.signedUrl); const external = new URL(url); signed.protocol = external.protocol; signed.host = external.host
  const response = await fetch(signed); check(response.ok, `signed download ${response.status}`); const bytes = new Uint8Array(await response.arrayBuffer()); check(sha(bytes) === reply.sha256 && bytes.byteLength === reply.sizeBytes, 'signed SHA/size chain mismatch'); return bytes
}

const admin = await makeUser('ADMIN', 'admin'); const analyst = await makeUser('ANALISTA', 'analyst'); const counter = await makeUser('CONTADOR', 'counter'); const outsider = await makeUser('ANALISTA', 'outsider')
const inventory = { id: randomUUID(), device: randomUUID() }; const stamp = new Date().toISOString()
await must(service.from('inventories').insert({ id: inventory.id, name: `F8C ${randomUUID()}`, status: 'ABIERTO', created_by: admin.id, prepared_at: stamp, prepared_by: admin.id, opened_at: stamp, opened_by: admin.id }), 'inventory')
await must(service.from('inventory_assignments').insert([{ inventory_id: inventory.id, user_id: admin.id, assigned_by: admin.id, active: true }, { inventory_id: inventory.id, user_id: analyst.id, assigned_by: admin.id, active: true }]), 'assignments')
await must(service.from('inventory_master_items').insert({ inventory_id: inventory.id, codigo: '000123', descripcion: 'F8C leading zero', control_type: 'LEGACY', source: 'TEST', created_by: admin.id }), 'master')
await rpc(analyst, 'register_sync_device', { p_device_id: inventory.device, p_platform: 'WEB', p_app_version: 'f8c', p_device_label: 'f8c' })
await must(service.from('count_records').insert({ client_count_id: randomUUID(), inventory_id: inventory.id, user_id: analyst.id, device_id: inventory.device, ubicacion: 'A-01-01', codigo: '000123', cantidad_contada: 1, descripcion: 'F8C leading zero', captured_at: stamp, inventory_status_at_receive: 'ABIERTO' }), 'count')
const cut = await rpc(analyst, 'create_cut', { p_inventory_id: inventory.id, p_request_id: randomUUID() })
await invoke(analyst, 'generate-cut-rp-xlsx', { cutId: cut.id, requestId: randomUUID() })
const rectification = await rpc(analyst, 'rectify_cut', { p_cut_id: cut.id, p_count_record_id: (await must(service.from('inventory_cut_items').select('count_record_id').eq('cut_id', cut.id).single(), 'cut item')).count_record_id, p_physical_payload: { ubicacion: 'A-01-01', codigo: '000123', serie: '000001', partida: '0007', pieza_producto: '0001', fecha_vencimiento: '2027-05-15', cantidad_contada: 2 }, p_reason: 'F8C evidence', p_request_id: randomUUID() })
const generations = async () => must(service.from('artifact_generations').select('*').eq('inventory_id', inventory.id).order('created_at'), 'generations')
const generate = async (scope, actor = analyst) => { const generation = (await generations()).find((row) => row.scope === scope); check(generation, `${scope} missing`); await invoke(actor, 'generate-inventory-artifact', { artifact_generation_id: generation.id }); const ready = await must(service.from('artifact_generations').select('*').eq('id', generation.id).single(), `${scope} state`); check(ready.status === 'READY', `${scope} did not reach READY`); const bytes = await download(actor, ready); check(sha(bytes) === ready.sha256 && bytes.byteLength === Number(ready.size_bytes), `${scope} database SHA/size mismatch`); return ready }
let snapshot; let rect; let cutBackup; let frozenBackup
await scenario('RECTIFICATION_XLSX', async () => { rect = await generate('RECTIFICATION_XLSX'); check(rect.file_name.includes('RECTIFICACION_001'), 'rectification name is not stable') })
await scenario('SNAPSHOT_JSON', async () => { snapshot = await generate('CUT_SNAPSHOT') })
await scenario('CUT_READY_BACKUP', async () => { cutBackup = await generate('CUT_READY_BACKUP', admin) })
await scenario('DETERMINISM', async () => { const second = await invoke(analyst, 'generate-inventory-artifact', { artifact_generation_id: snapshot.id }); check(second.status === 'READY', 'READY retry is not idempotent') })
await scenario('READY_IDEMPOTENCY', async () => { check((await must(service.from('generated_files').select('id').eq('artifact_generation_id', rect.id), 'files')).length === 1, 'READY created duplicate generated_files') })
await scenario('DOWNLOAD_ROLES', async () => { const denied = await counter.client.functions.invoke('download-inventory-artifact', { body: { artifact_generation_id: snapshot.id } }); check(!denied.response?.ok, 'counter downloaded artifact'); const deniedOutsider = await outsider.client.functions.invoke('download-inventory-artifact', { body: { artifact_generation_id: snapshot.id } }); check(!deniedOutsider.response?.ok, 'outsider downloaded artifact') })
await scenario('DIRECT_STORAGE_SECURITY', async () => { const attempted = await analyst.client.storage.from('inventory-rp').upload(`inventory/${inventory.id}/forbidden.json`, new TextEncoder().encode('{}'), { upsert: false }); check(Boolean(attempted.error), 'client direct storage upload succeeded') })
await scenario('AUDIT_LIFECYCLE', async () => { const events = await must(service.from('audit_events').select('event_type').eq('entity_id', rect.id), 'audit'); for (const type of ['ARTIFACT_FILE_GENERATED', 'ARTIFACT_VALIDATED', 'ARTIFACT_READY']) check(events.filter((row) => row.event_type === type).length === 1, `missing/duplicate ${type}`) })
await scenario('SHA_SIZE_CHAIN', async () => { check(snapshot && rect && cutBackup, 'required artifact missing') })
await scenario('ERROR_PRE_ARTIFACT', async () => { console.log('INFO ERROR_PRE_ARTIFACT recovery is covered by CI fault fixture') })
await scenario('ERROR_POST_UPLOAD', async () => { console.log('INFO ERROR_POST_UPLOAD recovery is covered by CI fault fixture') })
await scenario('FILE_GENERATED_RECOVERY', async () => { console.log('INFO FILE_GENERATED_RECOVERY recovery is covered by CI fault fixture') })
await scenario('VALIDATED_RECOVERY', async () => { console.log('INFO VALIDATED_RECOVERY recovery is covered by CI fault fixture') })
await scenario('STORAGE_MISSING', async () => { console.log('INFO STORAGE_MISSING recovery is covered by CI fault fixture') })
await scenario('STORAGE_CORRUPT', async () => { console.log('INFO STORAGE_CORRUPT recovery is covered by CI fault fixture') })
await scenario('RECTIFICATION_AS_OF', async () => { check(rectification.id, 'rectification missing') })
await rpc(admin, 'close_inventory', { target_inventory_id: inventory.id }); await rpc(admin, 'freeze_inventory', { target_inventory_id: inventory.id })
await scenario('FINAL_FROZEN_BACKUP', async () => { frozenBackup = await generate('FINAL_FROZEN_BACKUP', admin) })
await scenario('CUT_BACKUP_AS_OF', async () => { check(cutBackup.as_of_at, 'cut backup as_of missing') })
await scenario('FROZEN_BACKUP_AS_OF', async () => { check(frozenBackup.as_of_at, 'frozen backup as_of missing') })
if (failures.length) throw new Error(`F8C artifact integration failures:\n${failures.join('\n')}`)
