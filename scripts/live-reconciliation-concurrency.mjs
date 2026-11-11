/**
 * Local-only proof that two independent PostgreSQL C1 sessions reconcile the
 * same identity into one live C2 case and one mission. It uses production C1
 * RPCs and real psql connections; it never contacts a remote project.
 */
import { spawn, spawnSync } from 'node:child_process'

const container = process.env.SUPABASE_DB_CONTAINER ?? 'supabase_db_inven3'
const ids = {
  admin: 'c2210000-0000-0000-0000-000000000001',
  c1a: 'c2210000-0000-0000-0000-000000000002',
  c1b: 'c2210000-0000-0000-0000-000000000003',
  inventory: 'c2220000-0000-0000-0000-000000000001',
  deviceA: 'c2230000-0000-0000-0000-000000000001',
  deviceB: 'c2230000-0000-0000-0000-000000000002',
}

function runSql(sql) {
  return new Promise((resolve, reject) => {
    const child = spawn('docker', ['exec', '-i', container, 'psql', '-U', 'postgres', '-d', 'postgres', '-v', 'ON_ERROR_STOP=1', '-Atq'], { stdio: ['pipe', 'pipe', 'pipe'] })
    let stdout = ''; let stderr = ''
    child.stdout.on('data', (chunk) => { stdout += chunk })
    child.stderr.on('data', (chunk) => { stderr += chunk })
    child.on('error', reject)
    child.on('close', (code) => code === 0 ? resolve(stdout.trim()) : reject(new Error(stderr || `psql failed with exit ${code}`)))
    child.stdin.end(sql)
  })
}

function assert(value, message) { if (!value) throw new Error(message) }

const cleanup = `
delete from public.recount_mission_lifecycle_events where inventory_id='${ids.inventory}';
delete from public.reconciliation_events where inventory_id='${ids.inventory}';
delete from public.recount_mission_observations where mission_id in (select id from public.recount_missions where inventory_id='${ids.inventory}');
delete from public.recount_mission_subtasks where inventory_id='${ids.inventory}';
delete from public.recount_missions where inventory_id='${ids.inventory}';
delete from public.reconciliation_cases where inventory_id='${ids.inventory}';
delete from public.preseal_guard_events where count_record_id in (select id from public.count_records where inventory_id='${ids.inventory}');
delete from public.audit_events where inventory_id='${ids.inventory}';
delete from app_private.inventory_device_activity where inventory_id='${ids.inventory}';
delete from public.count_records where inventory_id='${ids.inventory}';
delete from public.sync_devices where user_id in ('${ids.c1a}','${ids.c1b}');
delete from public.inventory_system_reference_items where inventory_id='${ids.inventory}';
delete from public.inventory_system_reference_metadata where inventory_id='${ids.inventory}';
delete from public.inventory_master_items where inventory_id='${ids.inventory}';
delete from public.inventory_master_metadata where inventory_id='${ids.inventory}';
delete from public.inventory_assignments where inventory_id='${ids.inventory}';
delete from public.inventories where id='${ids.inventory}';
delete from public.profiles where user_id in ('${ids.admin}','${ids.c1a}','${ids.c1b}');
delete from auth.users where id in ('${ids.admin}','${ids.c1a}','${ids.c1b}');
`

const setup = `${cleanup}
insert into auth.users(id,aud,role,email,encrypted_password,raw_app_meta_data,raw_user_meta_data,created_at,updated_at) values
 ('${ids.admin}','authenticated','authenticated','live-race-admin@example.invalid','','{}','{}',now(),now()),
 ('${ids.c1a}','authenticated','authenticated','live-race-a@example.invalid','','{}','{}',now(),now()),
 ('${ids.c1b}','authenticated','authenticated','live-race-b@example.invalid','','{}','{}',now(),now());
insert into public.profiles(user_id,display_name,role,active) values
 ('${ids.admin}','Live race admin','ADMIN',true),
 ('${ids.c1a}','Live race C1 A','CONTADOR',true),
 ('${ids.c1b}','Live race C1 B','CONTADOR',true);
insert into public.inventories(id,name,created_by) values('${ids.inventory}','Live reconciliation race','${ids.admin}');
insert into public.inventory_assignments(inventory_id,user_id,assigned_by) values
 ('${ids.inventory}','${ids.admin}','${ids.admin}'),
 ('${ids.inventory}','${ids.c1a}','${ids.admin}'),
 ('${ids.inventory}','${ids.c1b}','${ids.admin}');
begin; set local role authenticated; set local request.jwt.claim.sub='${ids.admin}';
select * from public.import_inventory_master('${ids.inventory}','[{"codigo":"RACELEGACY","descripcion":"Live race SKU"}]'::jsonb,'TEST','live-race-master');
select * from public.import_inventory_system_reference('${ids.inventory}','[{"codigo":"RACELEGACY","quantity":10,"available_quantity":10,"unit_code":"UNI"}]'::jsonb,'TEST','live-race-reference');
select public.prepare_inventory('${ids.inventory}');
select public.open_inventory('${ids.inventory}');
commit;
`

try {
  const health = spawnSync('docker', ['inspect', '-f', '{{.State.Running}}', container], { encoding: 'utf8' })
  assert(health.status === 0 && health.stdout.trim() === 'true', `Local Supabase database ${container} is not running`)
  await runSql(setup)

  const c1A = runSql(`begin; set local role authenticated; set local request.jwt.claim.sub='${ids.c1a}';
select result_status from public.sync_counts('${ids.inventory}','${ids.deviceA}','WEB','0.0.00.02','live-race-A',
'[{"client_count_id":"c2240000-0000-0000-0000-000000000001","ubicacion":"A-01-01","codigo":"RACELEGACY","cantidad_contada":4,"captured_at":"2026-11-11T11:00:00Z"}]'::jsonb);
select pg_sleep(1); commit;`)
  await new Promise((resolve) => setTimeout(resolve, 120))
  const c1B = runSql(`begin; set local role authenticated; set local request.jwt.claim.sub='${ids.c1b}';
select result_status from public.sync_counts('${ids.inventory}','${ids.deviceB}','WEB','0.0.00.02','live-race-B',
'[{"client_count_id":"c2240000-0000-0000-0000-000000000002","ubicacion":"A-01-02","codigo":"RACELEGACY","cantidad_contada":4,"captured_at":"2026-11-11T11:00:01Z"}]'::jsonb);
commit;`)
  const [resultA, resultB] = await Promise.all([c1A, c1B])
  const caseCount = await runSql(`select count(*) from public.reconciliation_cases where inventory_id='${ids.inventory}' and codigo='RACELEGACY' and status='REQUIERE_2DO_CONTEO';`)
  const missionCount = await runSql(`select count(*) from public.recount_missions where inventory_id='${ids.inventory}' and round=2 and status='QUEUED' and source_cut_id is null;`)
  const eventCount = await runSql(`select count(*) from public.reconciliation_events where inventory_id='${ids.inventory}' and event_type='LIVE_C2_CREATED';`)
  const c1Open = await runSql(`select (c1_completed_at is null)::text from public.inventories where id='${ids.inventory}';`)
  const explain = await runSql(`set enable_seqscan=off; explain (analyze,buffers,costs off) select id from public.reconciliation_cases where inventory_id='${ids.inventory}'::uuid and codigo='RACELEGACY' and status='REQUIERE_2DO_CONTEO';`)

  assert(resultA.includes('ACCEPTED') && resultB.includes('ACCEPTED'), `Both C1 RPCs must be accepted: A=${resultA}; B=${resultB}`)
  assert(caseCount === '1', `Expected one logical live C2 case, received ${caseCount}`)
  assert(missionCount === '1', `Expected one queued live C2 mission, received ${missionCount}`)
  assert(eventCount === '1', `Expected one LIVE_C2_CREATED event, received ${eventCount}`)
  assert(c1Open === 'true', 'Live C2 was only created after C1 completion')
  console.log(explain)
  console.log('PASS live reconciliation PostgreSQL concurrency: two C1 sessions, one C2 case, one task, one creation event.')
} finally {
  await runSql(cleanup).catch(() => {})
}
