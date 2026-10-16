/**
 * Local-only proof for the two C3 race boundaries: C2 completion creates one
 * C3, and two eligible C3 counters cannot claim it twice.  No remote project
 * or production data is contacted.
 */
import { spawn, spawnSync } from 'node:child_process'

const container = process.env.SUPABASE_DB_CONTAINER ?? 'supabase_db_inven3'
const ids = {
  admin: 'f2750000-0000-0000-0000-000000000001', c2: 'f2750000-0000-0000-0000-000000000002',
  c3a: 'f2750000-0000-0000-0000-000000000003', c3b: 'f2750000-0000-0000-0000-000000000004',
  inventory: 'f2760000-0000-0000-0000-000000000001', case: 'f2770000-0000-0000-0000-000000000001',
  c2mission: 'f2780000-0000-0000-0000-000000000001', device: 'f2790000-0000-0000-0000-000000000001',
}

function runSql(sql) {
  return new Promise((resolve, reject) => {
    const child = spawn('docker', ['exec', '-i', container, 'psql', '-U', 'postgres', '-d', 'postgres', '-v', 'ON_ERROR_STOP=1', '-Atq'], { stdio: ['pipe', 'pipe', 'pipe'] })
    let stdout = ''; let stderr = ''
    child.stdout.on('data', (chunk) => { stdout += chunk }); child.stderr.on('data', (chunk) => { stderr += chunk })
    child.on('error', reject); child.on('close', (code) => code === 0 ? resolve(stdout.trim()) : reject(new Error(stderr || `psql exited ${code}`)))
    child.stdin.end(sql)
  })
}
function assert(value, message) { if (!value) throw new Error(message) }
const cleanup = `
delete from public.recount_mission_lifecycle_events where inventory_id='${ids.inventory}';
delete from public.reconciliation_events where inventory_id='${ids.inventory}';
delete from public.recount_subtask_serial_scans where subtask_id in (select id from public.recount_mission_subtasks where inventory_id='${ids.inventory}');
delete from public.recount_subtask_findings where subtask_id in (select id from public.recount_mission_subtasks where inventory_id='${ids.inventory}');
delete from public.recount_mission_subtasks where inventory_id='${ids.inventory}';
delete from public.recount_mission_observations where mission_id in (select id from public.recount_missions where inventory_id='${ids.inventory}');
delete from public.preseal_guard_events where count_record_id in (select id from public.count_records where inventory_id='${ids.inventory}');
delete from public.audit_events where inventory_id='${ids.inventory}';
delete from app_private.inventory_device_activity where inventory_id='${ids.inventory}';
delete from public.recount_missions where inventory_id='${ids.inventory}';
delete from public.reconciliation_cases where inventory_id='${ids.inventory}';
delete from public.count_records where inventory_id='${ids.inventory}';
delete from public.sync_devices where user_id in ('${ids.admin}','${ids.c2}','${ids.c3a}','${ids.c3b}');
delete from public.inventory_master_items where inventory_id='${ids.inventory}';
delete from public.inventory_assignments where inventory_id='${ids.inventory}';
delete from public.inventories where id='${ids.inventory}';
delete from public.profiles where user_id in ('${ids.admin}','${ids.c2}','${ids.c3a}','${ids.c3b}');
delete from auth.users where id in ('${ids.admin}','${ids.c2}','${ids.c3a}','${ids.c3b}');`
const setup = `${cleanup}
insert into auth.users(id,aud,role,email,encrypted_password,raw_app_meta_data,raw_user_meta_data,created_at,updated_at) values
 ('${ids.admin}','authenticated','authenticated','cut207-admin@example.invalid','','{}','{}',now(),now()),
 ('${ids.c2}','authenticated','authenticated','cut207-c2@example.invalid','','{}','{}',now(),now()),
 ('${ids.c3a}','authenticated','authenticated','cut207-c3a@example.invalid','','{}','{}',now(),now()),
 ('${ids.c3b}','authenticated','authenticated','cut207-c3b@example.invalid','','{}','{}',now(),now());
insert into public.profiles(user_id,display_name,role,active) values
 ('${ids.admin}','CUT207 admin','ADMIN',true),('${ids.c2}','CUT207 C2','CONTADOR',true),
 ('${ids.c3a}','CUT207 C3 A','ANALISTA',true),('${ids.c3b}','CUT207 C3 B','ANALISTA',true);
insert into public.inventories(id,name,status,created_by,prepared_at,prepared_by,opened_at,opened_by,c1_completed_at,c1_completed_by,c1_count_records,c1_counted_units,c1_master_fingerprint,c1_reference_fingerprint)
values('${ids.inventory}','CUT207 C3 concurrency','ABIERTO','${ids.admin}',now(),'${ids.admin}',now(),'${ids.admin}',now(),'${ids.admin}',0,0,repeat('a',64),repeat('b',64));
insert into public.inventory_assignments(inventory_id,user_id,assigned_by) values
 ('${ids.inventory}','${ids.c2}','${ids.admin}'),('${ids.inventory}','${ids.c3a}','${ids.admin}'),('${ids.inventory}','${ids.c3b}','${ids.admin}');
insert into public.inventory_master_items(inventory_id,codigo,descripcion,control_type,source,created_by)
values('${ids.inventory}','CUT207C3','C3 concurrency SKU','LEGACY','TEST','${ids.admin}');
insert into public.reconciliation_cases(id,inventory_id,codigo,reference_type,anomaly_type,system_quantity,physical_quantity,status,created_by)
values('${ids.case}','${ids.inventory}','CUT207C3','LEGACY','CUT207',9,7,'REQUIERE_2DO_CONTEO','${ids.admin}');
insert into public.recount_missions(id,case_id,inventory_id,round,status,assigned_user_id,claimed_at,created_by)
values('${ids.c2mission}','${ids.case}','${ids.inventory}',2,'ACTIVE','${ids.c2}',now(),'${ids.admin}');
begin; set local role authenticated; set local request.jwt.claim.sub='${ids.c2}';
select * from public.sync_counts('${ids.inventory}','${ids.device}','WEB','1.0.0','CUT207 C2',
 '[{"client_count_id":"f27a0000-0000-0000-0000-000000000001","ubicacion":"A-01-01","codigo":"CUT207C3","cantidad_contada":8,"captured_at":"2026-10-16T15:00:00Z"}]'::jsonb); commit;`

try {
  const health = spawnSync('docker', ['inspect', '-f', '{{.State.Running}}', container], { encoding: 'utf8' })
  assert(health.status === 0 && health.stdout.trim() === 'true', `Local Supabase database container ${container} is not running`)
  await runSql(setup)

  const completeA = runSql(`begin; set local role authenticated; set local request.jwt.claim.sub='${ids.c2}'; select public.complete_my_recount_mission('${ids.c2mission}'::uuid); select pg_sleep(2); commit;`)
  await new Promise((resolve) => setTimeout(resolve, 250))
  await runSql(`begin; set local role authenticated; set local request.jwt.claim.sub='${ids.c2}'; do $$begin perform public.complete_my_recount_mission('${ids.c2mission}'::uuid); exception when others then null; end$$; commit;`)
  await completeA

  const c3 = await runSql(`select id||'|'||source_c2_mission_id||'|'||coalesce(source_cut_id::text,'')||'|'||coalesce(source_sealed_reference_id::text,'') from public.recount_missions where case_id='${ids.case}' and round=3;`)
  const createdEvents = await runSql(`select count(*) from public.reconciliation_events where case_id='${ids.case}' and event_type='C3_CREATED';`)
  assert(c3.split('|')[1] === ids.c2mission, `C3 source C2 mismatch: ${c3}`)
  assert(createdEvents === '1', `Expected one C3_CREATED audit event, received ${createdEvents}`)

  const c3Id = c3.split('|')[0]
  const claimA = runSql(`begin; set local role authenticated; set local request.jwt.claim.sub='${ids.c3a}'; select coalesce(public.claim_next_recount_mission('${ids.inventory}'::uuid)::text,'NULL'); select pg_sleep(2); commit;`)
  await new Promise((resolve) => setTimeout(resolve, 250))
  const claimB = await runSql(`begin; set local role authenticated; set local request.jwt.claim.sub='${ids.c3b}'; select coalesce(public.claim_next_recount_mission('${ids.inventory}'::uuid)::text,'NULL'); commit;`)
  const winner = await claimA
  const assignees = await runSql(`select count(*) from public.recount_missions where id='${c3Id}' and status='ACTIVE' and assigned_user_id='${ids.c3a}';`)
  const auditClaims = await runSql(`select count(*) from public.reconciliation_events where case_id='${ids.case}' and event_type='THIRD_ASSIGNED';`)
  const explain = await runSql(`set enable_seqscan=off; explain (analyze, buffers, costs off) select id from public.recount_missions where inventory_id='${ids.inventory}'::uuid and round=3 and status='QUEUED' order by created_at,id;`)
  assert(winner.includes(c3Id), `C3 actor A did not claim C3: ${winner}`)
  assert(claimB === 'NULL', `C3 actor B claimed a locked C3: ${claimB}`)
  assert(assignees === '1', `Expected one C3 assignee, received ${assignees}`)
  assert(auditClaims === '1', `Expected one THIRD_ASSIGNED audit event, received ${auditClaims}`)
  assert(explain.includes('recount_missions_c3_queue_idx'), `C3 queue query did not use its focused index:\n${explain}`)

  // C3 has no reassignment path: C2 reassignment is deliberately round-2
  // only, so an in-flight independent count cannot be reassigned mid-flight.
  const reassignAttempt = await runSql(`begin; set local role authenticated; set local request.jwt.claim.sub='${ids.admin}'; do $$begin perform public.reassign_recount_mission('${c3Id}'::uuid,'C3 no se reasigna'); exception when insufficient_privilege then null; end$$; commit; select status||'|'||assigned_user_id from public.recount_missions where id='${c3Id}';`)
  assert(reassignAttempt === `ACTIVE|${ids.c3a}`, `C3 reassignment changed an active mission: ${reassignAttempt}`)

  // A capability revocation after an online claim blocks both a subsequent
  // claim/read attempt and completion. Evidence is not converted into a
  // valid result while authorization is stale.
  await runSql(`update public.profiles set user_type='EXTERNAL_AUDITOR' where user_id='${ids.c3a}';`)
  let revokedCompletion = ''
  try {
    await runSql(`begin; set local role authenticated; set local request.jwt.claim.sub='${ids.c3a}'; select public.complete_my_recount_mission_zero('${c3Id}'::uuid); commit;`)
  } catch (error) { revokedCompletion = String(error) }
  assert(revokedCompletion.includes('AUTHORIZATION_REVOKED'), `Revoked C3 completion was not denied: ${revokedCompletion}`)
  const afterRevocation = await runSql(`select status||'|'||coalesce(completed_at::text,'') from public.recount_missions where id='${c3Id}';`)
  assert(afterRevocation.startsWith('ACTIVE|'), `Revoked C3 completion changed mission state: ${afterRevocation}`)
  const revokedClaim = await runSql(`begin; set local role authenticated; set local request.jwt.claim.sub='${ids.c3a}'; do $$begin perform public.claim_next_recount_mission('${ids.inventory}'::uuid); exception when insufficient_privilege then null; end$$; commit;`)
  assert(revokedClaim === '', `Revoked C3 actor unexpectedly claimed a mission: ${revokedClaim}`)

  await runSql(`update public.profiles set user_type='PERMANENT' where user_id='${ids.c3a}'; begin; set local role authenticated; set local request.jwt.claim.sub='${ids.c3a}'; select public.complete_my_recount_mission_zero('${c3Id}'::uuid); commit;`)
  const completionAudit = await runSql(`select count(*) from public.reconciliation_events where case_id='${ids.case}' and event_type='THIRD_RECORDED';`)
  const completed = await runSql(`select status||'|'||coalesce(c3_result,'') from public.recount_missions where id='${c3Id}';`)
  assert(completed.startsWith('COMPLETED|'), `Restored C3 completion did not finish: ${completed}`)
  assert(completionAudit === '1', `Expected one C3 completion audit event, received ${completionAudit}`)
  console.log(explain)
  console.log('PASS CUT2-07 PostgreSQL concurrency: C3 creation/claim winner, no C3 reassignment, and revocation-safe completion.')
} finally { await runSql(cleanup).catch(() => {}) }
