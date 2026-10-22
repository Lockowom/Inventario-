/**
 * Local-only RP browser integration.  The service key never reaches Vite or
 * Chromium: it is used only here to create and remove an isolated fixture.
 */
import { spawn, spawnSync } from 'node:child_process'
import { randomUUID } from 'node:crypto'
import { writeFileSync } from 'node:fs'
import { createClient } from '@supabase/supabase-js'
import { chromium } from '@playwright/test'

const localHost = /^(localhost|127\.0\.0\.1)$/
const run = randomUUID().slice(0, 8)
const password = `RP-local-${run}-only!`
const ids = { inventory: randomUUID(), reference: randomUUID(), finding: randomUUID(), stale: randomUUID(), c2Reference: randomUUID(), c3Reference: randomUUID(), c2Case: randomUUID(), c3Case: randomUUID(), c2Mission: randomUUID(), c3SourceMission: randomUUID(), c3Mission: randomUUID(), foreignInventory: randomUUID(), foreignReference: randomUUID(), foreignWarehouse: randomUUID() }
let userId = null
let viewerId = null
let vite = null
let outcome = 'FAILED'
let failure = null
let cleanupFailure = null
const scenarios = []

function assert(value, message) { if (!value) throw new Error(message) }
function command(name, args) { return process.platform === 'win32' ? spawnSync('cmd.exe', ['/d', '/s', '/c', name, ...args], { encoding: 'utf8' }) : spawnSync(name, args, { encoding: 'utf8' }) }
function sql(statement) {
  const child = spawn('docker', ['exec', '-i', 'supabase_db_inven3', 'psql', '-U', 'postgres', '-d', 'postgres', '-v', 'ON_ERROR_STOP=1', '-Atq'], { stdio: ['pipe', 'pipe', 'pipe'] })
  return new Promise((resolve, reject) => { let out = '', err = ''; child.stdout.on('data', x => { out += x }); child.stderr.on('data', x => { err += x }); child.on('close', code => code === 0 ? resolve(out.trim()) : reject(new Error(err))); child.stdin.end(statement) })
}
function localStatus() {
  const output = command('supabase', ['status', '--output', 'json'])
  assert(output.status === 0, `Supabase local no disponible: ${output.stderr}`)
  const status = JSON.parse(output.stdout); const host = new URL(status.API_URL).hostname
  assert(localHost.test(host), `LOCAL_E2E_REMOTE_HOST_DENIED:${host}`)
  return status
}
async function wait(url) { for (let i = 0; i < 80; i += 1) { try { if ((await fetch(url)).ok) return } catch {} await new Promise(resolve => setTimeout(resolve, 250)) } throw new Error('VITE_LOCAL_E2E_NOT_READY') }
async function cleanup() {
  if (!userId) return
  await sql(`set session_replication_role=replica;
    delete from public.reference_finding_events where finding_id in (select id from public.reference_findings where inventory_id='${ids.inventory}');
    delete from public.finding_evidence where finding_id in (select id from public.reference_findings where inventory_id='${ids.inventory}');
    delete from public.reference_findings where inventory_id='${ids.inventory}';
    delete from public.recount_missions where inventory_id='${ids.inventory}';
    delete from public.reconciliation_cases where inventory_id='${ids.inventory}';
    delete from public.rp_release_events where inventory_id='${ids.inventory}';
    delete from public.rp_release_audits where inventory_id='${ids.inventory}';
    delete from public.rp_release_batches where inventory_id='${ids.inventory}';
    delete from public.inventory_sealed_references where inventory_id='${ids.inventory}';
    delete from public.inventory_sealed_references where inventory_id='${ids.foreignInventory}';
    delete from public.inventory_master_items where inventory_id='${ids.inventory}';
    delete from public.inventory_assignments where inventory_id='${ids.inventory}';
    delete from public.inventory_assignments where inventory_id='${ids.foreignInventory}';
    delete from public.inventories where id='${ids.inventory}';
    delete from public.inventories where id='${ids.foreignInventory}';
    delete from public.warehouses where id='${ids.foreignWarehouse}';
    delete from public.profiles where user_id in ('${userId}','${viewerId}'); delete from auth.users where id in ('${userId}','${viewerId}');
    set session_replication_role=origin;`)
}

try {
  const status = localStatus()
  const service = createClient(status.API_URL, status.SERVICE_ROLE_KEY, { auth: { persistSession: false, autoRefreshToken: false } })
  const email = `cut209c-rp-${run}@example.invalid`
  const created = await service.auth.admin.createUser({ email, password, email_confirm: true })
  assert(!created.error && created.data.user, `LOCAL_AUTH_BOOTSTRAP_FAILED:${created.error?.message}`); userId = created.data.user.id
  const viewerEmail = `cut209c-viewer-${run}@example.invalid`; const viewer = await service.auth.admin.createUser({ email: viewerEmail, password, email_confirm: true })
  assert(!viewer.error && viewer.data.user, `LOCAL_VIEWER_BOOTSTRAP_FAILED:${viewer.error?.message}`); viewerId = viewer.data.user.id
  await sql(`insert into public.profiles(user_id,display_name,role,user_type,active) values ('${userId}','CUT2-09C RP ${run}','ANALISTA','PERMANENT',true);
    insert into public.inventories(id,name,status,warehouse_id,created_by,prepared_at,prepared_by,opened_at,opened_by)
    values('${ids.inventory}','CUT2-09C LOCAL ${run}','ABIERTO','00000000-0000-0000-0000-00000000c202','${userId}',now(),'${userId}',now(),'${userId}');
    insert into public.inventory_assignments(inventory_id,user_id,assigned_by) values ('${ids.inventory}','${userId}','${userId}');
    insert into public.inventory_master_items(inventory_id,codigo,descripcion,control_type,source,created_by) values
      ('${ids.inventory}','R02-${run.toUpperCase()}','Identidad R02 local','LEGACY','CUT2-09C','${userId}'),
      ('${ids.inventory}','R05-${run.toUpperCase()}','Identidad R05 local','LEGACY','CUT2-09C','${userId}');
    insert into public.inventory_sealed_references(id,inventory_id,warehouse_id,reference_type,codigo,reference_value,normalized_reference_key,state,request_id,physical_quantity,sealed_at,sealed_by)
    values('${ids.reference}','${ids.inventory}','00000000-0000-0000-0000-00000000c202','LEGACY','RP-${run.toUpperCase()}',null,public.normalize_reference_key('LEGACY','RP-${run.toUpperCase()}',null),'SEALED','${randomUUID()}',7,now(),'${userId}'),
      ('${ids.finding}','${ids.inventory}','00000000-0000-0000-0000-00000000c202','LEGACY','R02-${run.toUpperCase()}',null,public.normalize_reference_key('LEGACY','R02-${run.toUpperCase()}',null),'SEALED','${randomUUID()}',4,now(),'${userId}'),
      ('${ids.stale}','${ids.inventory}','00000000-0000-0000-0000-00000000c202','LEGACY','R05-${run.toUpperCase()}',null,public.normalize_reference_key('LEGACY','R05-${run.toUpperCase()}',null),'SEALED','${randomUUID()}',3,now(),'${userId}'),
      ('${ids.c2Reference}','${ids.inventory}','00000000-0000-0000-0000-00000000c202','LEGACY','R10C2-${run.toUpperCase()}',null,public.normalize_reference_key('LEGACY','R10C2-${run.toUpperCase()}',null),'SEALED','${randomUUID()}',2,now(),'${userId}'),
      ('${ids.c3Reference}','${ids.inventory}','00000000-0000-0000-0000-00000000c202','LEGACY','R10C3-${run.toUpperCase()}',null,public.normalize_reference_key('LEGACY','R10C3-${run.toUpperCase()}',null),'SEALED','${randomUUID()}',2,now(),'${userId}');
    insert into public.profiles(user_id,display_name,role,user_type,active) values ('${viewerId}','CUT2-09C viewer ${run}','CONTADOR','PERMANENT',true);
    insert into public.inventory_assignments(inventory_id,user_id,assigned_by) values ('${ids.inventory}','${viewerId}','${userId}');
    insert into public.warehouses(id,code,name,timezone,operational_hours_id) values ('${ids.foreignWarehouse}','R6${run.toUpperCase()}','CUT2-09C foreign ${run}','America/Santiago','00000000-0000-0000-0000-00000000c201');
    insert into public.inventories(id,name,status,warehouse_id,created_by,prepared_at,prepared_by,opened_at,opened_by) values ('${ids.foreignInventory}','CUT2-09C FOREIGN ${run}','ABIERTO','${ids.foreignWarehouse}','${userId}',now(),'${userId}',now(),'${userId}');
    insert into public.inventory_sealed_references(id,inventory_id,warehouse_id,reference_type,codigo,reference_value,normalized_reference_key,state,request_id,physical_quantity,sealed_at,sealed_by) values ('${ids.foreignReference}','${ids.foreignInventory}','${ids.foreignWarehouse}','LEGACY','R06-${run.toUpperCase()}',null,public.normalize_reference_key('LEGACY','R06-${run.toUpperCase()}',null),'SEALED','${randomUUID()}',2,now(),'${userId}');`)
  const actor = createClient(status.API_URL, status.ANON_KEY, { auth: { persistSession: false, autoRefreshToken: false } }); const actorLogin = await actor.auth.signInWithPassword({ email, password }); assert(!actorLogin.error, 'RP_ADMIN_AUTH_FAILED')
  const viewerClient = createClient(status.API_URL, status.ANON_KEY, { auth: { persistSession: false, autoRefreshToken: false } }); const viewerLogin = await viewerClient.auth.signInWithPassword({ email: viewerEmail, password }); assert(!viewerLogin.error, 'RP_VIEWER_AUTH_FAILED')
  const finding = await actor.rpc('report_c1_reference_finding', { p_inventory_id: ids.inventory, p_reference_type: 'LEGACY', p_codigo: `R02-${run.toUpperCase()}`, p_reference_value: null, p_finding_type: 'OTHER', p_description: 'RP blocker local real', p_critical: true, p_source_event_key: `r02-${run}`, p_captured_at: new Date().toISOString(), p_offline: false, p_evidence: { note: 'local real blocker' } })
  assert(!finding.error, `R02_FINDING_CREATE_FAILED:${finding.error?.message}`)
  const r02 = await actor.rpc('preview_rp_release', { p_inventory_id: ids.inventory, p_warehouse_id: '00000000-0000-0000-0000-00000000c202', p_reference_ids: [ids.finding] })
  assert(!r02.error && Number(r02.data.blocked_references) === 1, 'R02_BLOCKER_NOT_RECALCULATED'); const r02Create = await actor.rpc('create_rp_release', { p_inventory_id: ids.inventory, p_warehouse_id: '00000000-0000-0000-0000-00000000c202', p_reference_ids: [ids.finding], p_expected_fingerprint: r02.data.fingerprint, p_request_id: randomUUID() }); assert(r02Create.error, 'R02_BLOCKED_CREATE_ACCEPTED'); scenarios.push('R02')
  const r05Preview = await actor.rpc('preview_rp_release', { p_inventory_id: ids.inventory, p_warehouse_id: '00000000-0000-0000-0000-00000000c202', p_reference_ids: [ids.stale] }); assert(!r05Preview.error, 'R05_PREVIEW_FAILED')
  // Mirror the canonical PREVIEW_STALE contract: a material sealed snapshot
  // change between preview and create must be detected by the production RPC.
  await sql(`update public.inventory_sealed_references set physical_quantity=physical_quantity+1 where id='${ids.stale}'`)
  const r05ChangedPreview = await actor.rpc('preview_rp_release', { p_inventory_id: ids.inventory, p_warehouse_id: '00000000-0000-0000-0000-00000000c202', p_reference_ids: [ids.stale] })
  assert(!r05ChangedPreview.error && r05ChangedPreview.data.fingerprint !== r05Preview.data.fingerprint, 'R05_MATERIAL_FINGERPRINT_UNCHANGED')
  let r05Error = ''
  try {
    await sql(`begin; select set_config('request.jwt.claim.sub','${userId}',true); set local role authenticated; select public.create_rp_release('${ids.inventory}','00000000-0000-0000-0000-00000000c202',array['${ids.stale}'::uuid],'${r05Preview.data.fingerprint}','${randomUUID()}'); commit;`)
  } catch (error) { r05Error = error instanceof Error ? error.message : String(error) }
  assert(/PREVIEW_STALE/.test(r05Error), `R05_STALE_NOT_DENIED:${r05Error || 'accepted'}`); scenarios.push('R05')
  const r03 = await viewerClient.rpc('create_rp_release', { p_inventory_id: ids.inventory, p_warehouse_id: '00000000-0000-0000-0000-00000000c202', p_reference_ids: [ids.reference], p_expected_fingerprint: 'x', p_request_id: randomUUID() }); assert(r03.error, 'R03_VIEWER_CREATE_ACCEPTED'); scenarios.push('R03')
  const r06 = await actor.rpc('preview_rp_release', { p_inventory_id: ids.foreignInventory, p_warehouse_id: ids.foreignWarehouse, p_reference_ids: [ids.foreignReference] }); assert(r06.error && !String(r06.error.message).includes(`R06-${run.toUpperCase()}`), 'R06_FOREIGN_SCOPE_LEAK'); scenarios.push('R06')
  await sql(`insert into public.reconciliation_cases(id,inventory_id,codigo,reference_type,anomaly_type,system_quantity,physical_quantity,status,created_by) values ('${ids.c2Case}','${ids.inventory}','R10C2-${run.toUpperCase()}','LEGACY','RP-C2',2,2,'REQUIERE_2DO_CONTEO','${userId}'),('${ids.c3Case}','${ids.inventory}','R10C3-${run.toUpperCase()}','LEGACY','RP-C3',2,2,'REQUIERE_3ER_CONTEO','${userId}');
    insert into public.recount_missions(id,case_id,inventory_id,round,status,assigned_user_id,claimed_at,completed_at,total_quantity,created_by,source_sealed_reference_id,source_c2_mission_id) values ('${ids.c2Mission}','${ids.c2Case}','${ids.inventory}',2,'QUEUED',null,null,null,null,'${userId}','${ids.c2Reference}',null),('${ids.c3SourceMission}','${ids.c3Case}','${ids.inventory}',2,'COMPLETED','${userId}',now(),now(),2,'${userId}','${ids.c3Reference}',null),('${ids.c3Mission}','${ids.c3Case}','${ids.inventory}',3,'QUEUED',null,null,null,null,'${userId}','${ids.c3Reference}','${ids.c3SourceMission}');`)
  const r10 = await actor.rpc('preview_rp_release', { p_inventory_id: ids.inventory, p_warehouse_id: '00000000-0000-0000-0000-00000000c202', p_reference_ids: [ids.c2Reference, ids.c3Reference] }); assert(!r10.error && Number(r10.data.blocked_references) === 2, 'R10_RECOUNT_BLOCKERS_NOT_RECALCULATED'); scenarios.push('R10')
  // R05 intentionally changes one fixture before the release is attempted;
  // R09 verifies that the release itself makes no additional stock mutation.
  const releaseBaseline = await sql(`select count(*)||':'||coalesce(sum(physical_quantity),0) from public.inventory_sealed_references where inventory_id='${ids.inventory}'`)
  const probe = await service.rpc('preview_rp_release', { p_inventory_id: ids.inventory, p_warehouse_id: '00000000-0000-0000-0000-00000000c202', p_reference_ids: [ids.reference] })
  // service_role is intentionally not an actor; the browser actor below is the authority test.
  assert(probe.error, 'SERVICE_ROLE_MUST_NOT_BE_USED_AS_RP_ACTOR')

  const viteEnv = { ...process.env, VITE_SUPABASE_URL: status.API_URL, VITE_SUPABASE_ANON_KEY: status.ANON_KEY, E2E_BACKEND: 'local' }
  delete viteEnv.SERVICE_ROLE_KEY; delete viteEnv.SUPABASE_SERVICE_ROLE_KEY; delete viteEnv.VITE_SUPABASE_SERVICE_ROLE_KEY
  vite = spawn(process.platform === 'win32' ? 'cmd.exe' : 'npm', process.platform === 'win32' ? ['/d', '/s', '/c', 'npm run dev -- --host 127.0.0.1 --port 4175'] : ['run', 'dev', '--', '--host', '127.0.0.1', '--port', '4175'], {
    env: viteEnv, stdio: 'ignore', windowsHide: true,
  })
  await wait('http://127.0.0.1:4175')
  const browser = await chromium.launch({ headless: true }); const page = await browser.newPage(); page.setDefaultTimeout(60_000)
  const remote = []; page.on('request', request => { const host = new URL(request.url()).hostname; if (!localHost.test(host)) remote.push(request.url()) })
  await page.goto('http://127.0.0.1:4175', { waitUntil: 'domcontentloaded', timeout: 60_000 })
  await page.getByLabel('Correo').fill(email); await page.getByLabel('Contraseña').fill(password); await page.getByRole('button', { name: 'INICIAR SESIÓN' }).click()
  await page.getByRole('button', { name: 'Liberación RP' }).click()
  await page.getByLabel('Referencias selladas (IDs)').fill(ids.reference)
  await page.getByRole('button', { name: 'PREVISUALIZAR RELEASE' }).click()
  await page.getByRole('region', { name: 'Vista previa RP' }).waitFor()
  await page.getByText('Elegibles: 1 · bloqueadas: 0').waitFor(); await page.getByText('Fingerprint:').waitFor()
  scenarios.push('R01')
  await page.getByRole('button', { name: 'CREAR DRAFT' }).click(); await page.getByText('Release DRAFT creado desde el snapshot validado.').waitFor()
  scenarios.push('R04')
  await page.getByText('Estado:').waitFor(); await page.getByRole('button', { name: 'VALIDAR MANIFIESTO Y MARCAR READY' }).click()
  scenarios.push('R07')
  await page.getByRole('button', { name: 'DESCARGAR XLSX RP' }).waitFor(); const download = page.waitForEvent('download'); await page.getByRole('button', { name: 'DESCARGAR XLSX RP' }).click(); const file = await download
  assert(file.suggestedFilename().startsWith('RP_RELEASE_'), 'XLSX_DOWNLOAD_CONTRACT_FAILED')
  scenarios.push('R08')
  const afterRelease = await sql(`select count(*)||':'||coalesce(sum(physical_quantity),0) from public.inventory_sealed_references where inventory_id='${ids.inventory}'`)
  assert(releaseBaseline === afterRelease, 'R09_RELEASE_MUTATED_SEALED_STOCK'); scenarios.push('R09')
  assert(remote.length === 0, `REMOTE_REQUESTS_DETECTED:${remote.join(',')}`)
  await browser.close()
  outcome = 'PASSED'
  console.log(`PASS RP local real ${run}: ${scenarios.join(',')}; remote requests=0; service role browser exposure=0.`)
} catch (error) {
  failure = error instanceof Error ? error.message : String(error)
  throw error
} finally {
  if (vite) {
    if (process.platform === 'win32') spawnSync('taskkill', ['/pid', String(vite.pid), '/t', '/f'], { stdio: 'ignore', windowsHide: true })
    else vite.kill()
  }
  try { await cleanup() } catch (error) {
    cleanupFailure = error instanceof Error ? error.message : String(error)
    outcome = 'FAILED'; failure ??= `CLEANUP_FAILED:${cleanupFailure}`
  }
  writeFileSync('test-results/cut2-09c-rp-local.json', JSON.stringify({ outcome, run, localOnly: true, scenarios, failure, cleanupFailure }))
  if (cleanupFailure) process.exitCode = 1
}
