/**
 * CUT2-10C local Chromium proof.  Bootstrap uses the service key in this Node
 * process only; Vite and Chromium receive the anon key and local API URL.
 */
import { spawn, spawnSync } from 'node:child_process'
import { randomUUID } from 'node:crypto'
import { createClient } from '@supabase/supabase-js'
import { chromium } from '@playwright/test'

const container = process.env.SUPABASE_DB_CONTAINER ?? 'supabase_db_inven3'
const localHost = /^(localhost|127\.0\.0\.1)$/
const run = randomUUID().slice(0, 8)
const password = `C10C-local-${run}-only!`
const warehouse = '00000000-0000-0000-0000-00000000c202'
const ids = Object.fromEntries(['ready', 'finding', 'missions', 'rp', 'foreign', 'ref', 'c2Case', 'c2', 'c3Case', 'c3Source', 'c3', 'release'].map((key) => [key, randomUUID()]))
let actorId = null; let viewerId = null; let vite = null; let browser = null; let viteOutput = ''
const passed = []

const assert = (value, message) => { if (!value) throw new Error(message) }
const command = (name, args) => process.platform === 'win32' ? spawnSync('cmd.exe', ['/d', '/s', '/c', name, ...args], { encoding: 'utf8' }) : spawnSync(name, args, { encoding: 'utf8' })
function sql(statement) {
  const child = spawn('docker', ['exec', '-i', container, 'psql', '-U', 'postgres', '-d', 'postgres', '-v', 'ON_ERROR_STOP=1', '-Atq'], { stdio: ['pipe', 'pipe', 'pipe'] })
  return new Promise((resolve, reject) => { let out = ''; let err = ''; child.stdout.on('data', (value) => { out += value }); child.stderr.on('data', (value) => { err += value }); child.on('close', (code) => code === 0 ? resolve(out.trim()) : reject(new Error(err || `psql exited ${code}`))); child.stdin.end(statement) })
}
const actorSql = (statement) => `begin; set local role authenticated; set local request.jwt.claim.sub='${actorId}'; ${statement}; commit;`
async function denied(work, expected) { try { await work(); } catch (error) { assert(String(error).includes(expected), `Expected ${expected}, got ${String(error)}`); return } throw new Error(`Expected denial ${expected}`) }
function status() {
  const result = command('supabase', ['status', '--output', 'json']); assert(result.status === 0, `LOCAL_SUPABASE_UNAVAILABLE:${result.stderr}`)
  const value = JSON.parse(result.stdout); assert(localHost.test(new URL(value.API_URL).hostname), 'REMOTE_SUPABASE_DENIED'); return value
}
async function wait(url) { for (let attempt = 0; attempt < 80; attempt += 1) { try { if ((await fetch(url)).ok) return } catch { /* Vite still boots. */ } await new Promise((resolve) => setTimeout(resolve, 250)) } throw new Error('VITE_LOCAL_E2E_NOT_READY') }
function base(inventoryId, label) {
  const code = `C10C-${label}-${run}`.toUpperCase()
  return `insert into public.inventories(id,name,status,warehouse_id,created_by,prepared_at,prepared_by,opened_at,opened_by,c1_completed_at,c1_completed_by,c1_count_records,c1_counted_units,c1_master_fingerprint,c1_reference_fingerprint)
    values('${inventoryId}','CUT2-10C ${label} ${run}','ABIERTO','${warehouse}','${actorId}',now(),'${actorId}',now(),'${actorId}',now(),'${actorId}',0,0,'c10c-master-${label}','c10c-reference-${label}');
    insert into public.inventory_assignments(inventory_id,user_id,assigned_by) values('${inventoryId}','${actorId}','${actorId}');
    insert into public.inventory_master_items(inventory_id,codigo,descripcion,control_type,source,created_by) values('${inventoryId}','${code}','C10C ${label}','LEGACY','CUT2-10C','${actorId}');
    insert into public.inventory_system_reference_items(inventory_id,codigo,reference_type,quantity,source_total_quantity,source_available_quantity,unit_code) values('${inventoryId}','${code}','LEGACY',1,1,1,'UN');`
}
async function cleanup() {
  if (!actorId) return
  const inventoryIds = [ids.ready, ids.finding, ids.missions, ids.rp, ids.foreign].map((id) => `'${id}'`).join(',')
  await sql(`set session_replication_role=replica;
    delete from public.audit_events where inventory_id in (${inventoryIds});
    delete from public.inventory_close_requests where inventory_id in (${inventoryIds});
    delete from public.rp_release_events where inventory_id in (${inventoryIds});
    delete from public.rp_release_discards where release_id in (select id from public.rp_release_batches where inventory_id in (${inventoryIds}));
    delete from public.rp_release_audits where inventory_id in (${inventoryIds});
    delete from public.rp_release_batches where inventory_id in (${inventoryIds});
    delete from public.recount_missions where inventory_id in (${inventoryIds});
    delete from public.reconciliation_cases where inventory_id in (${inventoryIds});
    delete from public.finding_evidence where finding_id in (select id from public.reference_findings where inventory_id in (${inventoryIds}));
    delete from public.reference_finding_events where finding_id in (select id from public.reference_findings where inventory_id in (${inventoryIds}));
    delete from public.reference_findings where inventory_id in (${inventoryIds});
    delete from public.inventory_system_reference_items where inventory_id in (${inventoryIds});
    delete from public.inventory_master_items where inventory_id in (${inventoryIds});
    delete from public.inventory_sealed_references where inventory_id in (${inventoryIds});
    delete from public.inventory_assignments where inventory_id in (${inventoryIds});
    delete from public.inventories where id in (${inventoryIds});
    delete from public.profiles where user_id in ('${actorId}','${viewerId}'); delete from auth.users where id in ('${actorId}','${viewerId}');
    set session_replication_role=origin;`)
}

try {
  const local = status()
  const service = createClient(local.API_URL, local.SERVICE_ROLE_KEY, { auth: { persistSession: false, autoRefreshToken: false } })
  const created = await service.auth.admin.createUser({ email: `cut210c-${run}@example.invalid`, password, email_confirm: true }); assert(created.data.user && !created.error, `ACTOR_BOOTSTRAP:${created.error?.message}`); actorId = created.data.user.id
  const viewer = await service.auth.admin.createUser({ email: `cut210c-viewer-${run}@example.invalid`, password, email_confirm: true }); assert(viewer.data.user && !viewer.error, `VIEWER_BOOTSTRAP:${viewer.error?.message}`); viewerId = viewer.data.user.id
  await sql(`insert into public.profiles(user_id,display_name,role,user_type,active) values ('${actorId}','CUT2-10C actor ${run}','ANALISTA','PERMANENT',true),('${viewerId}','CUT2-10C viewer ${run}','CONTADOR','PERMANENT',true);
    ${base(ids.ready, 'READY')}${base(ids.finding, 'FINDING')}${base(ids.missions, 'MISSIONS')}${base(ids.rp, 'RP')}
    insert into public.inventories(id,name,status,warehouse_id,created_by,prepared_at,prepared_by,opened_at,opened_by,c1_completed_at,c1_completed_by,c1_count_records,c1_counted_units,c1_master_fingerprint,c1_reference_fingerprint)
    values('${ids.foreign}','CUT2-10C FOREIGN ${run}','ABIERTO','${warehouse}','${actorId}',now(),'${actorId}',now(),'${actorId}',now(),'${actorId}',0,0,'foreign-master','foreign-ref');`)
  const actor = createClient(local.API_URL, local.ANON_KEY, { auth: { persistSession: false, autoRefreshToken: false } }); assert(!(await actor.auth.signInWithPassword({ email: `cut210c-${run}@example.invalid`, password })).error, 'ACTOR_LOGIN_FAILED')
  const viewerClient = createClient(local.API_URL, local.ANON_KEY, { auth: { persistSession: false, autoRefreshToken: false } }); assert(!(await viewerClient.auth.signInWithPassword({ email: `cut210c-viewer-${run}@example.invalid`, password })).error, 'VIEWER_LOGIN_FAILED')

  // C02: canonical finding writer supplies the blocker; preview is still a pure scoped read.
  const c02 = await actor.rpc('create_preseal_reference_finding', { p_inventory_id: ids.finding, p_reference_type: 'LEGACY', p_normalized_reference_key: `C10C-FINDING-${run}`.toUpperCase(), p_finding_type: 'OTHER', p_description: 'C10C real close blocker', p_critical: true })
  assert(!c02.error, `C02_FINDING:${c02.error?.message}`)
  // A close policy is normally set by the canonical finding policy.  This
  // fixture makes that policy input explicit after the real C1 report path.
  await sql(`update public.reference_findings set blocks_close=true where id='${c02.data}'`)
  const c02Preview = await actor.rpc('preview_inventory_close', { p_inventory_id: ids.finding }); assert(!c02Preview.error && c02Preview.data.blocker_codes.includes('FINDING_BLOCKS_CLOSE'), 'C02_BLOCKER_MISSING'); await denied(() => actor.rpc('close_inventory_final', { p_inventory_id: ids.finding, p_expected_fingerprint: c02Preview.data.fingerprint, p_request_id: randomUUID() }).then(({ error }) => { if (error) throw new Error(error.message) }), 'INVENTORY_NOT_READY'); passed.push('C02')

  // C03: C2 and C3 use the existing source-chain trigger; no fabricated C3 source id is accepted.
  await sql(`insert into public.reconciliation_cases(id,inventory_id,codigo,reference_type,anomaly_type,system_quantity,physical_quantity,status,created_by) values ('${ids.c2Case}','${ids.missions}','C10C-MISSION-${run.toUpperCase()}','LEGACY','C10C',1,2,'REQUIERE_2DO_CONTEO','${actorId}'),('${ids.c3Case}','${ids.missions}','C10C-MISSION-${run.toUpperCase()}','LEGACY','C10C',1,2,'REQUIERE_3ER_CONTEO','${actorId}');
    insert into public.recount_missions(id,case_id,inventory_id,round,status,created_by) values ('${ids.c2}','${ids.c2Case}','${ids.missions}',2,'QUEUED','${actorId}');
    insert into public.recount_missions(id,case_id,inventory_id,round,status,assigned_user_id,claimed_at,completed_at,total_quantity,created_by) values ('${ids.c3Source}','${ids.c3Case}','${ids.missions}',2,'COMPLETED','${actorId}',now(),now(),2,'${actorId}');
    insert into public.recount_missions(id,case_id,inventory_id,round,status,created_by) values ('${ids.c3}','${ids.c3Case}','${ids.missions}',3,'QUEUED','${actorId}');`)
  const c03Preview = await actor.rpc('preview_inventory_close', { p_inventory_id: ids.missions }); assert(!c03Preview.error && c03Preview.data.blocker_codes.includes('OPEN_C2') && c03Preview.data.blocker_codes.includes('OPEN_C3'), 'C03_MISSION_BLOCKERS_MISSING'); passed.push('C03')

  // C04: only the CUT2-09 RPC moves a draft to READY, which clears coverage.
  await sql(`insert into public.inventory_sealed_references(id,inventory_id,warehouse_id,reference_type,codigo,normalized_reference_key,state,request_id,physical_quantity,sealed_at,sealed_by) values ('${ids.ref}','${ids.rp}','${warehouse}','LEGACY','C10C-RP-${run.toUpperCase()}',public.normalize_reference_key('LEGACY','C10C-RP-${run.toUpperCase()}',null),'SEALED','${randomUUID()}',1,now(),'${actorId}');`)
  const rpPreview = await actor.rpc('preview_rp_release', { p_inventory_id: ids.rp, p_warehouse_id: warehouse, p_reference_ids: [ids.ref] }); assert(!rpPreview.error, `C04_RP_PREVIEW:${rpPreview.error?.message}`)
  const draft = await actor.rpc('create_rp_release', { p_inventory_id: ids.rp, p_warehouse_id: warehouse, p_reference_ids: [ids.ref], p_expected_fingerprint: rpPreview.data.fingerprint, p_request_id: randomUUID() }); assert(!draft.error, `C04_DRAFT:${draft.error?.message}`)
  const draftClose = await actor.rpc('preview_inventory_close', { p_inventory_id: ids.rp }); assert(!draftClose.error && draftClose.data.blocker_codes.includes('RP_RELEASE_DRAFT'), 'C04_DRAFT_NOT_BLOCKING')
  const marked = await actor.rpc('mark_rp_release_ready', { p_release_id: draft.data.release_id, p_request_id: randomUUID() }); assert(!marked.error && marked.data.state === 'READY', `C04_READY:${marked.error?.message}`)
  const readyClose = await actor.rpc('preview_inventory_close', { p_inventory_id: ids.rp }); assert(!readyClose.error && readyClose.data.is_ready, 'C04_READY_NOT_CLEARED'); passed.push('C04')

  const viteEnv = { ...process.env, VITE_SUPABASE_URL: local.API_URL, VITE_SUPABASE_ANON_KEY: local.ANON_KEY, E2E_BACKEND: 'local' }; delete viteEnv.SERVICE_ROLE_KEY; delete viteEnv.SUPABASE_SERVICE_ROLE_KEY; delete viteEnv.VITE_SUPABASE_SERVICE_ROLE_KEY
  vite = spawn(process.platform === 'win32' ? 'cmd.exe' : 'npm', process.platform === 'win32' ? ['/d', '/s', '/c', 'npm run dev -- --host 127.0.0.1 --port 4176'] : ['run', 'dev', '--', '--host', '127.0.0.1', '--port', '4176'], { env: viteEnv, stdio: ['ignore', 'pipe', 'pipe'], windowsHide: true })
  vite.stdout.on('data', (value) => { viteOutput += String(value) }); vite.stderr.on('data', (value) => { viteOutput += String(value) })
  await wait('http://127.0.0.1:4176')
  browser = await chromium.launch({ headless: true }); const page = await browser.newPage(); page.setDefaultTimeout(20_000); const remote = []; const browserErrors = []; const browserConsole = []
  page.on('request', (request) => { const host = new URL(request.url()).hostname; if (!localHost.test(host)) remote.push(request.url()) })
  page.on('pageerror', (error) => browserErrors.push(error.message))
  page.on('console', (message) => { if (message.type() === 'error') browserConsole.push(message.text()) })
  await page.goto('http://127.0.0.1:4176', { waitUntil: 'load', timeout: 60_000 })
  await page.getByText('INICIAR SESIÓN').waitFor({ timeout: 30_000 }).catch(() => {})
  const startupText = await page.locator('body').innerText(); assert(startupText.includes('INICIAR SESIÓN'), `LOGIN_FORM_ABSENT:${startupText.slice(0, 500)}:HTML=${(await page.content()).slice(0, 800)}:VITE=${viteOutput.slice(-500)}:BROWSER=${browserErrors.join('|')}:CONSOLE=${browserConsole.join('|')}`)
  await page.getByLabel('Correo').fill(`cut210c-${run}@example.invalid`); await page.getByLabel('Contraseña').fill(password); await page.getByRole('button', { name: 'INICIAR SESIÓN' }).click(); await page.getByRole('heading', { name: 'CENTRO DE CONTROL DE INVENTARIO' }).waitFor()
  const select = page.getByLabel('Inventario activo')
  async function preview(inventoryId) {
    await select.selectOption(inventoryId)
    await page.getByRole('heading', { name: 'CIERRE DE INVENTARIO' }).waitFor()
    const action = page.getByRole('button', { name: 'REVISAR CIERRE' }).or(page.getByRole('button', { name: 'ACTUALIZAR PREVISUALIZACIÓN' }))
    await action.click()
    const closeRegion = page.getByRole('region', { name: 'Previsualización de cierre' })
    await closeRegion.waitFor()
    assert(await closeRegion.count() === 1, `CLOSE_PREVIEW_UI_FAILED:${await page.locator('.inventory-close').innerText()}`)
  }

  await preview(ids.ready); await page.getByText('INVENTARIO LISTO PARA CIERRE').waitFor(); await page.getByText('Huella:').waitFor(); passed.push('C01')
  // The same real panel must remain usable at the supported web widths.  A
  // scrollable blocker list is valid; an overflowing application viewport is not.
  for (const viewport of [{ width: 1440, height: 900 }, { width: 834, height: 1112 }, { width: 390, height: 844 }]) {
    await page.setViewportSize(viewport)
    const layout = await page.evaluate(() => ({ clientWidth: document.documentElement.clientWidth, scrollWidth: document.documentElement.scrollWidth }))
    assert(layout.scrollWidth <= layout.clientWidth, `RESPONSIVE_OVERFLOW_${viewport.width}:${layout.scrollWidth}/${layout.clientWidth}`)
  }
  await page.setViewportSize({ width: 1280, height: 900 })
  await preview(ids.finding); await page.getByText('FINDING_BLOCKS_CLOSE').waitFor(); assert(await page.getByRole('button', { name: 'CERRAR INVENTARIO' }).count() === 0, 'C02_UI_CLOSE_EXPOSED')
  await preview(ids.missions); await page.getByText('OPEN_C2').waitFor(); await page.getByText('OPEN_C3').waitFor()
  await preview(ids.rp); await page.getByText('INVENTARIO LISTO PARA CIERRE').waitFor()

  // C05: a real material change after browser preview makes the first fingerprint stale.
  await preview(ids.ready); const staleBefore = (await actor.rpc('preview_inventory_close', { p_inventory_id: ids.ready })).data.fingerprint
  await sql(actorSql(`select public.create_preseal_reference_finding('${ids.ready}','LEGACY','C10C-READY-${run.toUpperCase()}','OTHER','stale browser preview',true)`))
  await page.getByRole('button', { name: 'CERRAR INVENTARIO' }).click()
  await page.getByRole('button', { name: 'CONFIRMAR CIERRE' }).click()
  await page.getByText('El estado del inventario cambió desde la última revisión. Actualiza la previsualización.').waitFor()
  const staleAfter = (await actor.rpc('preview_inventory_close', { p_inventory_id: ids.ready })).data.fingerprint; assert(staleAfter !== staleBefore, 'C05_FINGERPRINT_UNCHANGED'); passed.push('C05')
  // Test fixture cleanup only: restore ready material after proving stale behavior.
  await sql(`set session_replication_role=replica; delete from public.reference_finding_events where finding_id in (select id from public.reference_findings where inventory_id='${ids.ready}'); delete from public.reference_findings where inventory_id='${ids.ready}'; set session_replication_role=origin;`)

  // C06/C07 use real Auth tokens and the guarded backend; browser never gets the service key.
  await denied(() => viewerClient.rpc('preview_inventory_close', { p_inventory_id: ids.ready }).then(({ error }) => { if (error) throw new Error(error.message) }), 'CAPABILITY_REQUIRED')
  await denied(() => actor.rpc('preview_inventory_close', { p_inventory_id: ids.foreign }).then(({ error }) => { if (error) throw new Error(error.message) }), 'CAPABILITY_REQUIRED'); passed.push('C06', 'C07')

  // C08/C09: browser confirmation reaches the canonical writer once; close has no stock/ERP side effect.
  await preview(ids.ready); const before = await sql(`select count(*)||':'||coalesce(sum(quantity),0) from public.inventory_system_reference_items where inventory_id='${ids.ready}'`)
  await page.getByRole('button', { name: 'CERRAR INVENTARIO' }).click(); const confirm = page.getByRole('button', { name: 'CONFIRMAR CIERRE' }); await confirm.dblclick(); await page.getByText(/Inventario cerrado correctamente/).waitFor()
  assert(await sql(`select count(*) from public.inventory_close_requests where inventory_id='${ids.ready}' and state='COMPLETED'`) === '1', 'C08_DOUBLE_CLOSE')
  assert(await sql(`select count(*) from public.audit_events where inventory_id='${ids.ready}' and event_type='INVENTORY_CLOSED'`) === '1', 'C08_AUDIT_NOT_UNIQUE')
  const after = await sql(`select count(*)||':'||coalesce(sum(quantity),0) from public.inventory_system_reference_items where inventory_id='${ids.ready}'`); assert(before === after, 'C09_STOCK_MUTATED'); passed.push('C08', 'C09')

  // C10: post-close writers remain locked server-side, including direct SQL attempts.
  await denied(() => sql(actorSql(`select public.create_preseal_reference_finding('${ids.ready}','LEGACY','C10C-READY-${run.toUpperCase()}','OTHER','after close',true)`)), 'INVENTORY_CLOSED')
  await denied(() => sql(`insert into public.recount_missions(case_id,inventory_id,round,status,created_by) values (gen_random_uuid(),'${ids.ready}',2,'QUEUED','${actorId}')`), 'INVENTORY_CLOSED')
  await denied(() => sql(`insert into public.rp_release_batches(inventory_id,warehouse_id,created_by,state) values ('${ids.ready}','${warehouse}','${actorId}','DRAFT')`), 'INVENTORY_CLOSED'); passed.push('C10')
  assert(remote.length === 0, `REMOTE_REQUESTS:${remote.join(',')}`)
  const browserStorage = await page.evaluate(() => ({
    local: Object.fromEntries(Array.from({ length: localStorage.length }, (_, index) => { const key = localStorage.key(index) ?? ''; return [key, localStorage.getItem(key) ?? ''] })),
    session: Object.fromEntries(Array.from({ length: sessionStorage.length }, (_, index) => { const key = sessionStorage.key(index) ?? ''; return [key, sessionStorage.getItem(key) ?? ''] })),
  }))
  assert(!JSON.stringify(browserStorage).includes(local.SERVICE_ROLE_KEY), 'SERVICE_ROLE_BROWSER_LEAK')
  console.log(`PASS CUT2-10C local-real ${run}: ${passed.join(',')}; remote requests=0; service role browser exposure=0.`)
} finally {
  if (browser) await browser.close().catch(() => {})
  if (vite) { if (process.platform === 'win32') spawnSync('taskkill', ['/pid', String(vite.pid), '/t', '/f'], { stdio: 'ignore', windowsHide: true }); else vite.kill() }
  await cleanup().catch((error) => { console.error(`CLEANUP_FAILED:${error instanceof Error ? error.message : String(error)}`); process.exitCode = 1 })
}
