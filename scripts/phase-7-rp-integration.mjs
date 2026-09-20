/* global process, console, fetch */
import { createHash, randomUUID } from 'node:crypto'
import { createClient } from '@supabase/supabase-js'
import { generateRpXlsx, validateRpXlsx } from '../src/domain/cut/rp-xlsx.ts'

const { API_URL: url, ANON_KEY: anonKey, SERVICE_ROLE_KEY: serviceKey } = process.env
if (!url || !anonKey || !serviceKey) throw new Error('Local Supabase status variables are required.')
const service = createClient(url, serviceKey)
const email = `phase7-${randomUUID()}@example.invalid`; const password = `P7-${randomUUID()}-safe`
const signedUp = await createClient(url, anonKey).auth.signUp({ email, password })
if (signedUp.error || !signedUp.data.user || !signedUp.data.session) throw new Error(`Cannot create analyst: ${signedUp.error?.message ?? 'missing session'}`)
const analystId = signedUp.data.user.id; const inventoryId = randomUUID(); const deviceId = randomUUID(); const now = new Date().toISOString()
async function must(result, name) { if (result.error) throw new Error(`${name}: ${result.error.message}`); return result.data }
await must(await service.from('profiles').insert({ user_id: analystId, display_name: 'Phase 7 analyst', role: 'ANALISTA', active: true }), 'profile')
await must(await service.from('inventories').insert({ id: inventoryId, name: `P7_${randomUUID()}`, status: 'ABIERTO', created_by: analystId, prepared_at: now, prepared_by: analystId, opened_at: now, opened_by: analystId }), 'inventory')
await must(await service.from('inventory_assignments').insert({ inventory_id: inventoryId, user_id: analystId, assigned_by: analystId, active: true }), 'assignment')
await must(await service.from('inventory_master_items').insert({ inventory_id: inventoryId, codigo: '001234', descripcion: 'RP snapshot description', control_type: 'LEGACY', source: 'TEST', created_by: analystId }), 'master')
const analyst = createClient(url, anonKey, { global: { headers: { Authorization: `Bearer ${signedUp.data.session.access_token}` } } })
const accepted = await must(await analyst.rpc('sync_counts', { p_inventory_id: inventoryId, p_device_id: deviceId, p_platform: 'WEB', p_app_version: 'phase7-ci', p_device_label: 'INVEN3 CI', p_records: [{ client_count_id: randomUUID(), ubicacion: 'A-01-01', codigo: '001234', serie: '00001', partida: '00725', pieza_producto: '0001', fecha_vencimiento: '2027-05-15', cantidad_contada: 20, captured_at: now }] }), 'accept count')
if (accepted[0]?.result_status !== 'ACCEPTED') throw new Error('Phase 7 fixture count was not accepted.')
const cut = await must(await analyst.rpc('create_cut', { p_inventory_id: inventoryId, p_request_id: randomUUID() }), 'cut')
const invoke = async (name, body) => { const response = await fetch(`${url}/functions/v1/${name}`, { method: 'POST', headers: { apikey: anonKey, Authorization: `Bearer ${signedUp.data.session.access_token}`, 'Content-Type': 'application/json' }, body: JSON.stringify(body) }); const data = await response.json(); if (!response.ok) { const failed = await analyst.from('inventory_cuts').select('status,generation_error').eq('id', body.cutId).maybeSingle(); throw new Error(`${name}: ${data.error ?? response.status}; cut=${failed.data?.status ?? 'unavailable'}; generator=${failed.data?.generation_error ?? 'unavailable'}`) }; return data }
const generated = await invoke('generate-cut-rp-xlsx', { cutId: cut.id, requestId: randomUUID() })
if (generated.status !== 'READY') throw new Error('Edge generation did not reach READY.')
const downloaded = await invoke('download-cut-rp-xlsx', { cutId: cut.id })
const file = await fetch(downloaded.signedUrl); if (!file.ok) throw new Error('Signed download failed.')
const bytes = new Uint8Array(await file.arrayBuffer()); const sha = createHash('sha256').update(bytes).digest('hex')
const metadata = await must(await service.from('generated_files').select('sha256,size_bytes').eq('cut_id', cut.id).single(), 'metadata')
if (sha !== metadata.sha256 || bytes.byteLength !== metadata.size_bytes) throw new Error('Downloaded bytes do not match official metadata.')
validateRpXlsx(bytes, [{ export_seq: 1, codigo: '001234', serie: '00001', partida: '00725', pieza_producto: '0001', fecha_vencimiento: '2027-05-15', cantidad_contada: 20, descripcion: 'RP snapshot description' }])
const large = Array.from({ length: 2350 }, (_, index) => ({ export_seq: index + 1, codigo: `SKU${String(index + 1).padStart(6, '0')}`, cantidad_contada: 1, descripcion: 'Large RP' }))
const started = Date.now(); validateRpXlsx(generateRpXlsx(large), large); console.log(`Phase 7 Edge+Storage integration passed: READY, signed download, SHA, 2,350 XLSX round-trip in ${Date.now() - started}ms.`)
