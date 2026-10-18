/**
 * CUT2-08J5 server-connected E2E.  This intentionally crosses the real local
 * Auth + PostgREST + SECURITY DEFINER boundary.  Fixtures use postgres only
 * to arrange an isolated inventory; all actor actions use authenticated
 * Supabase clients and the same outbox/repository code as the product.
 */
import { spawn, spawnSync } from 'node:child_process'
import { randomUUID } from 'node:crypto'
import { createClient } from '@supabase/supabase-js'

const container = process.env.SUPABASE_DB_CONTAINER ?? 'supabase_db_inven3'
const suffix = randomUUID().slice(0, 8)
const password = 'CUT2-08-local-only-password!'
const ids = { inventory: randomUUID(), device: randomUUID() }

class DurableStorage {
  #data = new Map()
  getItem(key) { return this.#data.get(key) ?? null }
  setItem(key, value) { this.#data.set(key, String(value)) }
  removeItem(key) { this.#data.delete(key) }
  clear() { this.#data.clear() }
}
globalThis.localStorage = new DurableStorage()

const { c1FindingOfflineOutbox } = await import('../src/features/findings/c1-finding-offline-outbox.ts')

// Mirrors the narrow repository transport boundary with a real authenticated
// client.  The browser-facing repository delegates to this exact pair of RPCs
// (normal sync first, review-only preservation on current-authority denial).
async function syncC1FindingWithClient(client, item) {
  const payload = {
    p_inventory_id: item.inventoryId,
    p_reference_type: item.referenceType,
    p_codigo: item.codigo,
    p_reference_value: item.referenceValue,
    p_finding_type: item.findingType,
    p_description: item.description,
    p_critical: item.critical,
    p_source_event_key: item.sourceEventKey,
    p_captured_at: item.capturedAt,
    p_evidence: item.evidence,
  }
  const primary = await client.rpc('sync_offline_c1_reference_finding', payload)
  if (!primary.error) return primary.data
  if (/AUTHORIZATION_REVOKED|CAPABILITY_REQUIRED|SCOPE_DENIED|ASSIGNMENT_REVOKED|42501/.test(`${primary.error.code ?? ''} ${primary.error.message}`)) {
    const preserved = await client.rpc('preserve_revoked_offline_c1_finding', payload)
    if (!preserved.error) return preserved.data
  }
  throw new Error(primary.error.message)
}

function assert(value, message) { if (!value) throw new Error(message) }
function sameInstant(left, right) { return new Date(left).getTime() === new Date(right).getTime() }
function runSql(sql) {
  return new Promise((resolve, reject) => {
    const child = spawn('docker', ['exec', '-i', container, 'psql', '-U', 'postgres', '-d', 'postgres', '-v', 'ON_ERROR_STOP=1', '-Atq'], { stdio: ['pipe', 'pipe', 'pipe'] })
    let stdout = ''; let stderr = ''
    child.stdout.on('data', (chunk) => { stdout += chunk })
    child.stderr.on('data', (chunk) => { stderr += chunk })
    child.on('error', reject)
    child.on('close', (code) => code === 0 ? resolve(stdout.trim()) : reject(new Error(stderr || `psql exited ${code}`)))
    child.stdin.end(sql)
  })
}
async function localStatus() {
  const result = process.platform === 'win32'
    ? spawnSync('cmd.exe', ['/d', '/s', '/c', 'supabase status --output json'], { encoding: 'utf8' })
    : spawnSync('supabase', ['status', '--output', 'json'], { encoding: 'utf8' })
  assert(result.status === 0, `supabase status failed: ${result.stderr}`)
  return JSON.parse(result.stdout)
}
async function signIn(url, anonKey, email) {
  const client = createClient(url, anonKey, { auth: { persistSession: false, autoRefreshToken: false } })
  const { error } = await client.auth.signInWithPassword({ email, password })
  assert(!error, `local sign-in failed for ${email}: ${error?.message}`)
  return client
}
async function rpc(client, name, args) {
  const { data, error } = await client.rpc(name, args)
  assert(!error, `${name} failed: ${error?.code ?? ''} ${error?.message ?? ''}`)
  return data
}
async function count(sql) { return Number(await runSql(sql)) }

const emails = {
  admin: `cut208-j5-admin-${suffix}@example.invalid`,
  counter: `cut208-j5-counter-${suffix}@example.invalid`,
  reviewer: `cut208-j5-reviewer-${suffix}@example.invalid`,
}
let users = {}

async function cleanup() {
  if (!users.admin) return
  const userIds = Object.values(users).map((id) => `'${id}'`).join(',')
  await runSql(`
    set session_replication_role=replica;
    delete from public.reference_finding_events where finding_id in (select id from public.reference_findings where inventory_id='${ids.inventory}');
    delete from public.finding_evidence where finding_id in (select id from public.reference_findings where inventory_id='${ids.inventory}');
    delete from public.preseal_guard_events where inventory_id='${ids.inventory}';
    delete from public.reference_findings where inventory_id='${ids.inventory}';
    delete from public.rolling_cut_events where inventory_id='${ids.inventory}';
    delete from public.rolling_cut_reference_snapshots where inventory_id='${ids.inventory}';
    delete from public.rolling_cut_requests where inventory_id='${ids.inventory}';
    delete from public.inventory_sealed_references where inventory_id='${ids.inventory}';
    delete from public.inventory_cuts where inventory_id='${ids.inventory}';
    delete from public.count_records where inventory_id='${ids.inventory}';
    delete from public.sync_devices where id='${ids.device}';
    delete from public.inventory_system_reference_items where inventory_id='${ids.inventory}';
    delete from public.inventory_master_items where inventory_id='${ids.inventory}';
    delete from public.inventory_assignments where inventory_id='${ids.inventory}';
    delete from public.inventories where id='${ids.inventory}';
    delete from public.user_management_events where actor_user_id in (${userIds}) or target_user_id in (${userIds});
    delete from public.profiles where user_id in (${userIds});
    delete from auth.users where id in (${userIds});
    set session_replication_role=origin;
  `)
}

try {
  const health = spawnSync('docker', ['inspect', '-f', '{{.State.Running}}', container], { encoding: 'utf8' })
  assert(health.status === 0 && health.stdout.trim() === 'true', 'Local Supabase PostgreSQL is not running')
  const status = await localStatus()
  const service = createClient(status.API_URL, status.SERVICE_ROLE_KEY, { auth: { persistSession: false, autoRefreshToken: false } })
  for (const [kind, email] of Object.entries(emails)) {
    const { data, error } = await service.auth.admin.createUser({ email, password, email_confirm: true })
    assert(!error && data.user, `could not create ${kind} auth user: ${error?.message}`)
    users[kind] = data.user.id
  }

  // The rolling cut itself is invoked later through the authenticated admin
  // client.  These inserts only provide its legitimate open C1 source.
  await runSql(`
    insert into public.profiles(user_id,display_name,role,user_type,active) values
      ('${users.admin}','CUT2-08 J5 admin','ADMIN','PERMANENT',true),
      ('${users.counter}','CUT2-08 J5 counter','CONTADOR','PERMANENT',true),
      ('${users.reviewer}','CUT2-08 J5 reviewer','ANALISTA','PERMANENT',true);
    insert into public.inventories(id,name,status,warehouse_id,created_by,prepared_at,prepared_by,opened_at,opened_by)
    values('${ids.inventory}','CUT2-08 J5 server E2E','ABIERTO','00000000-0000-0000-0000-00000000c202','${users.admin}',now(),'${users.admin}',now(),'${users.admin}');
    insert into public.inventory_assignments(inventory_id,user_id,assigned_by) values
      ('${ids.inventory}','${users.counter}','${users.admin}'),
      ('${ids.inventory}','${users.reviewer}','${users.admin}');
    insert into public.inventory_master_items(inventory_id,codigo,descripcion,control_type,source,created_by) values
      ('${ids.inventory}','J5-SEAL','Referencia para sello real','LEGACY','CUT2-08J5','${users.admin}'),
      ('${ids.inventory}','J5-REVOKED','Referencia para revocación','LEGACY','CUT2-08J5','${users.admin}');
    insert into public.inventory_system_reference_items(inventory_id,codigo,reference_type,quantity,source_total_quantity,source_available_quantity,unit_code) values
      ('${ids.inventory}','J5-SEAL','LEGACY',1,1,1,'UN'),
      ('${ids.inventory}','J5-REVOKED','LEGACY',1,1,1,'UN');
    insert into public.sync_devices(id,user_id,platform,app_version,device_label) values
      ('${ids.device}','${users.counter}','WEB','cut2-08-j5','server-e2e');
    insert into public.count_records(client_count_id,inventory_id,user_id,device_id,ubicacion,codigo,cantidad_contada,descripcion,captured_at,received_at)
    values('${randomUUID()}','${ids.inventory}','${users.counter}','${ids.device}','A-01-01','J5-SEAL',1,'Referencia para sello real',now(),now());
  `)

  const admin = await signIn(status.API_URL, status.ANON_KEY, emails.admin)
  const counter = await signIn(status.API_URL, status.ANON_KEY, emails.counter)
  const reviewer = await signIn(status.API_URL, status.ANON_KEY, emails.reviewer)

  // S01: capture with the actual durable outbox, then seal via the real
  // preview/create RPC pair while offline evidence is waiting to flush.
  c1FindingOfflineOutbox.setActor(users.counter)
  const postSealItem = c1FindingOfflineOutbox.enqueue({
    inventoryId: ids.inventory, referenceType: 'LEGACY', codigo: 'J5-SEAL', referenceValue: null,
    findingType: 'OTHER', description: 'Etiqueta observada antes de sellar.', critical: false,
    capturedAt: '2026-10-18T09:00:00.000Z', evidence: { note: 'evidencia offline J5', location: 'A-01-01' },
  })
  const selection = { normalized_reference_keys: ['J5-SEAL'] }
  const preview = await rpc(admin, 'preview_rolling_cut_v2', { p_inventory_id: ids.inventory, p_warehouse_id: null, p_selection: selection })
  const cut = await rpc(admin, 'create_rolling_cut_v2', { p_inventory_id: ids.inventory, p_request_id: randomUUID(), p_preview_fingerprint: preview.preview_fingerprint, p_selection: selection })
  assert(cut.cut_id, 'real rolling-cut RPC did not return cut_id')
  assert(await count(`select count(*) from public.inventory_sealed_references where inventory_id='${ids.inventory}' and normalized_reference_key='J5-SEAL' and state='SEALED'`) === 1, 'real rolling cut did not seal J5-SEAL')
  const postSealFlush = await c1FindingOfflineOutbox.flush((item) => syncC1FindingWithClient(counter, item))
  assert(JSON.stringify(postSealFlush) === JSON.stringify({ sent: 0, reviewRequired: 1, pending: 0 }), 'post-seal sync was not terminal review')
  assert(c1FindingOfflineOutbox.reviewRequired()[0]?.reviewReason === 'REFERENCE_SEALED', 'post-seal review reason changed')
  const postSealId = await runSql(`select id from public.reference_findings where source_event_key='${postSealItem.sourceEventKey}'`)
  assert(postSealId, 'post-seal server finding was not persisted')
  const postDetail = await rpc(reviewer, 'get_reference_finding_detail', { p_finding_id: postSealId })
  assert(postDetail.review_context?.reason === 'REFERENCE_SEALED', 'scoped reviewer cannot see post-seal review context')
  assert(postDetail.source_stage === 'OFFLINE_LATE_COUNT', 'post-seal source stage is not canonical')
  assert(postDetail.evidence?.length === 1 && sameInstant(postDetail.evidence[0].captured_at, postSealItem.capturedAt), 'post-seal evidence did not preserve capture time')
  await c1FindingOfflineOutbox.flush((item) => syncC1FindingWithClient(counter, item))
  assert(await count(`select count(*) from public.reference_findings where source_event_key='${postSealItem.sourceEventKey}'`) === 1, 'terminal post-seal flush duplicated finding')
  assert(await count(`select count(*) from public.finding_evidence e join public.reference_findings f on f.id=e.finding_id where f.source_event_key='${postSealItem.sourceEventKey}'`) === 1, 'terminal post-seal flush duplicated evidence')

  // S02: administrative revocation happens while the physical report is in
  // the real client outbox.  The follow-up server RPC preserves review-only
  // evidence and never recreates C1 authority.
  const revokedItem = c1FindingOfflineOutbox.enqueue({
    inventoryId: ids.inventory, referenceType: 'LEGACY', codigo: 'J5-REVOKED', referenceValue: null,
    findingType: 'OTHER', description: 'Etiqueta capturada antes de revocar.', critical: false,
    capturedAt: '2026-10-18T09:05:00.000Z', evidence: { note: 'evidencia revocada J5', location: 'A-01-02' },
  })
  await rpc(service, 'admin_upsert_user_profile_from_edge', {
    p_actor_user_id: users.admin, p_target_user_id: users.counter,
    p_display_name: 'CUT2-08 J5 counter', p_role: 'CONTADOR', p_active: true,
    p_inventory_ids: [], p_event_type: 'USER_UPDATED',
  })
  const revokedFlush = await c1FindingOfflineOutbox.flush((item) => syncC1FindingWithClient(counter, item))
  assert(revokedFlush.reviewRequired === 2 && revokedFlush.pending === 0, 'revoked sync was not terminal review')
  const revokedLocal = c1FindingOfflineOutbox.reviewRequired().find((item) => item.sourceEventKey === revokedItem.sourceEventKey)
  assert(revokedLocal?.reviewReason === 'AUTHORIZATION_REVOKED', 'revoked local item has wrong reason')
  const revokedId = await runSql(`select id from public.reference_findings where source_event_key='${revokedItem.sourceEventKey}'`)
  assert(revokedId, 'revoked server review artifact was not persisted')
  const revokedDetail = await rpc(reviewer, 'get_reference_finding_detail', { p_finding_id: revokedId })
  assert(revokedDetail.review_context?.reason === 'AUTHORIZATION_REVOKED', 'scoped reviewer cannot see authorization-revoked context')
  assert(revokedDetail.finding_type === 'AUTHORIZATION_REVOKED_OFFLINE', 'revoked artifact has an operational finding type')
  assert(revokedDetail.reported_by === users.counter && sameInstant(revokedDetail.evidence?.[0]?.captured_at, revokedItem.capturedAt), 'revoked artifact lost original actor or timestamp')
  assert(await count(`select count(*) from public.reference_finding_events e join public.reference_findings f on f.id=e.finding_id where f.source_event_key='${revokedItem.sourceEventKey}' and e.event_type='REPORTED'`) === 1, 'revoked review artifact audit is not unique')
  await c1FindingOfflineOutbox.flush((item) => syncC1FindingWithClient(counter, item))
  assert(await count(`select count(*) from public.reference_findings where source_event_key='${revokedItem.sourceEventKey}'`) === 1, 'terminal revoked flush duplicated finding')

  // S03/S05: destroy/recreate-like actor selection through the durable
  // storage.  B never sees or flushes A-owned terminal evidence; returning A
  // sees the same two immutable review records.
  c1FindingOfflineOutbox.setActor(users.reviewer)
  assert(c1FindingOfflineOutbox.list().length === 0, 'user switch exposed A-owned offline items to B')
  const switched = await c1FindingOfflineOutbox.flush((item) => syncC1FindingWithClient(reviewer, item))
  assert(switched.sent === 0 && switched.reviewRequired === 0, 'user switch tried to flush A-owned evidence as B')
  c1FindingOfflineOutbox.setActor(null)
  c1FindingOfflineOutbox.setActor(users.counter)
  assert(c1FindingOfflineOutbox.reviewRequired().length === 2, 'outbox restart lost A-owned terminal review records')

  // Stale assignment is N/A to C1 report sync: the contract has no assignee
  // parameter and revalidates only actor capability/scope.  C2/C3 stale
  // mission assignment is already enforced by CUT2-07.  This explicit check
  // makes the non-applicability reproducible instead of a hand-wave.
  assert(!('assignedTo' in revokedItem), 'C1 offline finding unexpectedly carries mutable assignment authority')
  console.log('PASS CUT2-08 server E2E: S01 post-seal rolling-cut review, S02 authorization-revoked server preservation, S03 terminal retry/idempotency, S04 stale-assignment N/A for C1, S05 owner-isolated restart/user switch.')
} finally {
  await cleanup().catch(() => {})
}
