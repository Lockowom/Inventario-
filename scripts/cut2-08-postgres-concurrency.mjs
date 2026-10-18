/**
 * CUT2-08I local-only concurrency proof.  Each runSql call owns a separate
 * PostgreSQL connection; no promise shares a transaction or a mocked lock.
 */
import { spawn, spawnSync } from 'node:child_process'

const container = process.env.SUPABASE_DB_CONTAINER ?? 'supabase_db_inven3'
const ids = {
  admin: 'c8910000-0000-0000-0000-000000000001',
  analystA: 'c8910000-0000-0000-0000-000000000002',
  analystB: 'c8910000-0000-0000-0000-000000000003',
  inventory: 'c8920000-0000-0000-0000-000000000001',
}

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
const assert = (value, message) => { if (!value) throw new Error(message) }
async function denied(sql, expected) {
  try { await runSql(sql) } catch (error) {
    assert(String(error).includes(expected), `Expected ${expected}, got ${error}`)
    return
  }
  throw new Error(`Expected denial ${expected}`)
}
const asActor = (actor, sql) => `begin; set local role authenticated; set local request.jwt.claim.sub='${actor}'; ${sql}; commit;`
// Audit/evidence history is intentionally immutable in production.  This is a
// postgres-superuser-only local fixture cleanup, never an application path.
const cleanup = `
set session_replication_role = replica;
delete from public.reference_finding_events where finding_id in (select id from public.reference_findings where inventory_id='${ids.inventory}');
delete from public.finding_evidence where finding_id in (select id from public.reference_findings where inventory_id='${ids.inventory}');
delete from public.preseal_guard_events where inventory_id='${ids.inventory}';
delete from public.reference_findings where inventory_id='${ids.inventory}';
delete from public.inventory_system_reference_items where inventory_id='${ids.inventory}';
delete from public.inventory_master_items where inventory_id='${ids.inventory}';
delete from public.inventory_assignments where inventory_id='${ids.inventory}';
delete from public.inventories where id='${ids.inventory}';
delete from public.profiles where user_id in ('${ids.admin}','${ids.analystA}','${ids.analystB}');
delete from auth.users where id in ('${ids.admin}','${ids.analystA}','${ids.analystB}');
set session_replication_role = origin;`
const setup = `${cleanup}
insert into auth.users(id,aud,role,email,encrypted_password,raw_app_meta_data,raw_user_meta_data,created_at,updated_at) values
 ('${ids.admin}','authenticated','authenticated','cut208-concurrency-admin@example.invalid','','{}','{}',now(),now()),
 ('${ids.analystA}','authenticated','authenticated','cut208-concurrency-a@example.invalid','','{}','{}',now(),now()),
 ('${ids.analystB}','authenticated','authenticated','cut208-concurrency-b@example.invalid','','{}','{}',now(),now());
insert into public.profiles(user_id,display_name,role,user_type,active) values
 ('${ids.admin}','CUT208 admin','ADMIN','PERMANENT',true),
 ('${ids.analystA}','CUT208 analyst A','ANALISTA','PERMANENT',true),
 ('${ids.analystB}','CUT208 analyst B','ANALISTA','PERMANENT',true);
insert into public.inventories(id,name,status,warehouse_id,created_by,prepared_at,prepared_by,opened_at,opened_by)
values('${ids.inventory}','CUT208 concurrency','ABIERTO','00000000-0000-0000-0000-00000000c202','${ids.admin}',now(),'${ids.admin}',now(),'${ids.admin}');
insert into public.inventory_assignments(inventory_id,user_id,assigned_by) values
 ('${ids.inventory}','${ids.analystA}','${ids.admin}'),('${ids.inventory}','${ids.analystB}','${ids.admin}');
insert into public.inventory_master_items(inventory_id,codigo,descripcion,control_type,source,created_by)
values('${ids.inventory}','C08-RACE','CUT2-08 race identity','LEGACY','TEST','${ids.admin}');
insert into public.inventory_system_reference_items(inventory_id,codigo,reference_type,quantity,source_total_quantity,source_available_quantity,unit_code)
values('${ids.inventory}','C08-RACE','LEGACY',1,1,1,'UN');`

async function createPreseal(description, critical = false) {
  return runSql(asActor(ids.admin, `select public.create_preseal_reference_finding('${ids.inventory}','LEGACY','C08-RACE','OTHER','${description}',${critical})`))
}

try {
  const health = spawnSync('docker', ['inspect', '-f', '{{.State.Running}}', container], { encoding: 'utf8' })
  assert(health.status === 0 && health.stdout.trim() === 'true', 'Local Supabase PostgreSQL is not running')
  await runSql(setup)

  // The source-event unique index is the production idempotency boundary used
  // by bridge sources.  Two independent writers contend on the same event key.
  const commonInsert = (sleep) => `begin; insert into public.reference_findings(inventory_id,warehouse_id,reference_type,normalized_reference_key,finding_type,source_event_key,critical,description,created_by) values ('${ids.inventory}','00000000-0000-0000-0000-00000000c202','LEGACY','C08-RACE','OTHER','cut208-race-event',false,'same upstream event','${ids.admin}') on conflict(source_event_key) where source_event_key is not null do nothing; ${sleep ? 'select pg_sleep(1);' : ''} commit;`
  const createA = runSql(commonInsert(true))
  await new Promise((resolve) => setTimeout(resolve, 150))
  const createB = runSql(commonInsert(false))
  await Promise.all([createA, createB])
  assert(await runSql(`select count(*) from public.reference_findings where source_event_key='cut208-race-event'`) === '1', 'create/create produced duplicate findings')
  assert(await runSql(`select count(*) from public.reference_finding_events e join public.reference_findings f on f.id=e.finding_id where f.source_event_key='cut208-race-event' and e.event_type='REPORTED'`) === '1', 'create/create produced duplicate audit')

  const resolveId = await createPreseal('resolve race')
  const resolveA = runSql(asActor(ids.analystA, `select public.resolve_reference_finding('${resolveId}','NO_ADJUSTMENT_REQUIRED','decision A'); select pg_sleep(1)`))
  await new Promise((resolve) => setTimeout(resolve, 150))
  const resolveB = runSql(asActor(ids.analystB, `select public.resolve_reference_finding('${resolveId}','FALSE_POSITIVE','decision B')`))
  await Promise.all([resolveA, resolveB])
  assert(await runSql(`select count(*) from public.reference_finding_events where finding_id='${resolveId}' and event_type='RESOLVED'`) === '1', 'resolve/resolve produced duplicate audit')
  assert(await runSql(`select resolution_code::text from public.reference_findings where id='${resolveId}'`) === 'NO_ADJUSTMENT_REQUIRED', 'resolve/resolve overwrote the committed decision')

  const assignId = await createPreseal('assign resolve race')
  const resolveWinner = runSql(asActor(ids.analystA, `select public.resolve_reference_finding('${assignId}','NO_ADJUSTMENT_REQUIRED','resolve wins'); select pg_sleep(1)`))
  await new Promise((resolve) => setTimeout(resolve, 150))
  await denied(asActor(ids.admin, `select public.assign_reference_finding('${assignId}','${ids.analystB}')`), 'FINDING_NOT_OPEN')
  await resolveWinner
  assert(await runSql(`select count(*) from public.reference_finding_events where finding_id='${assignId}' and event_type='ASSIGNED'`) === '0', 'assign after resolve emitted contradictory audit')

  const evidenceFirst = await createPreseal('evidence before resolution')
  await runSql(asActor(ids.analystA, `select public.add_reference_finding_evidence('${evidenceFirst}',jsonb_build_object('note','critical physical evidence','critical',true))`))
  await runSql(asActor(ids.analystB, `select public.resolve_reference_finding('${evidenceFirst}','NO_ADJUSTMENT_REQUIRED','reviewed appended evidence')`))
  assert(await runSql(`select count(*) from public.finding_evidence where finding_id='${evidenceFirst}'`) === '1', 'evidence-first was not preserved')
  assert(await runSql(`select count(*) from public.reference_finding_events where finding_id='${evidenceFirst}' and event_type='RESOLVED'`) === '1', 'evidence-first did not produce one resolution')

  // Two independent connections establish the opposite order: the typed
  // resolution holds the row lock first, then the critical evidence waits and
  // commits.  The controlled-reopen policy must retain both facts.
  const resolveThenEvidence = await createPreseal('resolution before critical evidence')
  const resolutionFirst = runSql(asActor(ids.analystA, `select public.resolve_reference_finding('${resolveThenEvidence}','NO_ADJUSTMENT_REQUIRED','initial decision'); select pg_sleep(1)`))
  await new Promise((resolve) => setTimeout(resolve, 150))
  const evidenceSecond = runSql(asActor(ids.analystB, `select public.add_reference_finding_evidence('${resolveThenEvidence}',jsonb_build_object('note','critical evidence after resolution','critical',true,'source_event_id','cut208-resolve-evidence-race'))`))
  await Promise.all([resolutionFirst, evidenceSecond])
  assert(await runSql(`select state::text from public.reference_findings where id='${resolveThenEvidence}'`) === 'OPEN', 'critical evidence after resolution did not reopen the finding')
  assert(await runSql(`select resolution_code::text from public.reference_findings where id='${resolveThenEvidence}'`) === 'NO_ADJUSTMENT_REQUIRED', 'reopen overwrote the committed typed decision')
  assert(await runSql(`select count(*) from public.reference_finding_events where finding_id='${resolveThenEvidence}' and event_type='RESOLVED'`) === '1', 'resolution/evidence produced duplicate resolution audit')
  assert(await runSql(`select count(*) from public.reference_finding_events where finding_id='${resolveThenEvidence}' and event_type='REOPENED'`) === '1', 'resolution/evidence omitted the canonical reopen audit')
  assert(await runSql(`select count(*) from public.finding_evidence where finding_id='${resolveThenEvidence}' and source_event_id='cut208-resolve-evidence-race'`) === '1', 'resolution/evidence lost the appended critical evidence')

  console.log('PASS CUT2-08 PostgreSQL concurrency: source-event create/create, resolve/resolve, resolve-wins assign/resolve, evidence-first resolution, and resolution-wins controlled reopen.')
} finally {
  await runSql(cleanup).catch(() => {})
}
