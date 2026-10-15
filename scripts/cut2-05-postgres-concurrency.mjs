/**
 * Local-only proof that two real PostgreSQL sessions cannot claim the same C2.
 * Requires the standard `supabase start` Docker database; it never contacts a
 * remote project.  Session A holds the row lock after its claim while session B
 * invokes the production RPC and must receive NULL through SKIP LOCKED.
 */
import { spawn, spawnSync } from 'node:child_process'

const container = process.env.SUPABASE_DB_CONTAINER ?? 'supabase_db_inven3'
const ids = {
  admin: 'f2550000-0000-0000-0000-000000000001',
  counterA: 'f2550000-0000-0000-0000-000000000002',
  counterB: 'f2550000-0000-0000-0000-000000000003',
  inventory: 'f2560000-0000-0000-0000-000000000001',
  case: 'f2570000-0000-0000-0000-000000000001',
  mission: 'f2580000-0000-0000-0000-000000000001',
}

function runSql(sql) {
  return new Promise((resolve, reject) => {
    const child = spawn('docker', ['exec', '-i', container, 'psql', '-U', 'postgres', '-d', 'postgres', '-v', 'ON_ERROR_STOP=1', '-Atq'], { stdio: ['pipe', 'pipe', 'pipe'] })
    let stdout = ''; let stderr = ''
    child.stdout.on('data', (chunk) => { stdout += chunk })
    child.stderr.on('data', (chunk) => { stderr += chunk })
    child.on('error', reject)
    child.on('close', (code) => code === 0 ? resolve(stdout.trim()) : reject(new Error(stderr || `psql failed with exit code ${code}`)))
    child.stdin.end(sql)
  })
}

function assert(value, message) { if (!value) throw new Error(message) }

const cleanup = `
delete from public.recount_mission_lifecycle_events where inventory_id='${ids.inventory}';
delete from public.recount_missions where inventory_id='${ids.inventory}';
delete from public.reconciliation_cases where inventory_id='${ids.inventory}';
delete from public.inventory_master_items where inventory_id='${ids.inventory}';
delete from public.inventory_assignments where inventory_id='${ids.inventory}';
delete from public.inventories where id='${ids.inventory}';
delete from public.profiles where user_id in ('${ids.admin}','${ids.counterA}','${ids.counterB}');
delete from auth.users where id in ('${ids.admin}','${ids.counterA}','${ids.counterB}');
`

const setup = `${cleanup}
insert into auth.users(id,aud,role,email,encrypted_password,raw_app_meta_data,raw_user_meta_data,created_at,updated_at) values
 ('${ids.admin}','authenticated','authenticated','cut205-concurrency-admin@example.invalid','','{}','{}',now(),now()),
 ('${ids.counterA}','authenticated','authenticated','cut205-concurrency-a@example.invalid','','{}','{}',now(),now()),
 ('${ids.counterB}','authenticated','authenticated','cut205-concurrency-b@example.invalid','','{}','{}',now(),now());
insert into public.profiles(user_id,display_name,role,active) values
 ('${ids.admin}','CUT205 concurrency admin','ADMIN',true),
 ('${ids.counterA}','CUT205 counter A','CONTADOR',true),
 ('${ids.counterB}','CUT205 counter B','CONTADOR',true);
insert into public.inventories(id,name,status,created_by,prepared_at,prepared_by,opened_at,opened_by,c1_completed_at,c1_completed_by,c1_count_records,c1_counted_units,c1_master_fingerprint,c1_reference_fingerprint)
values('${ids.inventory}','CUT205 concurrency','ABIERTO','${ids.admin}',now(),'${ids.admin}',now(),'${ids.admin}',now(),'${ids.admin}',0,0,repeat('a',64),repeat('b',64));
insert into public.inventory_assignments(inventory_id,user_id,assigned_by) values
 ('${ids.inventory}','${ids.counterA}','${ids.admin}'),('${ids.inventory}','${ids.counterB}','${ids.admin}');
insert into public.inventory_master_items(inventory_id,codigo,descripcion,control_type,source,created_by)
values('${ids.inventory}','CUT205CONC','C2 concurrency SKU','LEGACY','TEST','${ids.admin}');
insert into public.reconciliation_cases(id,inventory_id,codigo,reference_type,anomaly_type,system_quantity,physical_quantity,status,created_by)
values('${ids.case}','${ids.inventory}','CUT205CONC','LEGACY','CUT205',1,0,'REQUIERE_2DO_CONTEO','${ids.admin}');
insert into public.recount_missions(id,case_id,inventory_id,round,created_by)
values('${ids.mission}','${ids.case}','${ids.inventory}',2,'${ids.admin}');
`

try {
  const health = spawnSync('docker', ['inspect', '-f', '{{.State.Running}}', container], { encoding: 'utf8' })
  assert(health.status === 0 && health.stdout.trim() === 'true', `Local Supabase database container ${container} is not running`)
  await runSql(setup)

  const sessionA = runSql(`begin; set local role authenticated; set local request.jwt.claim.sub='${ids.counterA}'; select coalesce(public.claim_next_recount_mission('${ids.inventory}'::uuid)::text,'NULL'); select pg_sleep(2); commit;`)
  await new Promise((resolve) => setTimeout(resolve, 300))
  const sessionB = await runSql(`begin; set local role authenticated; set local request.jwt.claim.sub='${ids.counterB}'; select coalesce(public.claim_next_recount_mission('${ids.inventory}'::uuid)::text,'NULL'); commit;`)
  const resultA = await sessionA
  const active = await runSql(`select count(*) from public.recount_missions where id='${ids.mission}' and status='ACTIVE';`)
  const explain = await runSql(`set enable_seqscan=off; explain (analyze, buffers, costs off) select id from public.recount_missions where inventory_id='${ids.inventory}'::uuid and round=2 and status='ACTIVE' order by claim_due_at,c2_due_at,created_at,id;`)

  assert(resultA.includes(ids.mission), 'Session A did not claim the expected mission')
  assert(sessionB === 'NULL', `Session B claimed a locked mission: ${sessionB}`)
  assert(active === '1', `Expected exactly one active mission, received ${active}`)
  assert(explain.includes('recount_missions_c2_sla_queue_idx'), `C2 queue query did not use its SLA index:\n${explain}`)
  console.log(explain)
  console.log('PASS CUT2-05 PostgreSQL concurrency: one claim, one SKIP LOCKED miss, one active mission.')
} finally {
  await runSql(cleanup).catch(() => {})
}
