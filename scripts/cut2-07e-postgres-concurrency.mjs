/**
 * CUT2-07E local-only proof. Every command below opens its own psql process,
 * so the winner/loser assertions exercise PostgreSQL locks and commits rather
 * than an in-memory mock. No remote database is ever contacted.
 */
import { spawn, spawnSync } from 'node:child_process'

const container = process.env.SUPABASE_DB_CONTAINER ?? 'supabase_db_inven3'
const ids = {
  admin: 'f27e0000-0000-0000-0000-000000000001', c2: 'f27e0000-0000-0000-0000-000000000002',
  c3a: 'f27e0000-0000-0000-0000-000000000003', c3b: 'f27e0000-0000-0000-0000-000000000004', c3c: 'f27e0000-0000-0000-0000-000000000005',
  inventoryA: 'f27e1000-0000-0000-0000-000000000001', inventoryB: 'f27e1000-0000-0000-0000-000000000002',
  warehouseB: 'f27e2000-0000-0000-0000-000000000001',
  cutA: 'f27e3000-0000-0000-0000-000000000001', cutB: 'f27e3000-0000-0000-0000-000000000002',
  caseCompleteRevoked: 'f27e4000-0000-0000-0000-000000000001', c2CompleteRevoked: 'f27e4100-0000-0000-0000-000000000001', c3CompleteRevoked: 'f27e4200-0000-0000-0000-000000000001',
  caseCompleteWins: 'f27e4000-0000-0000-0000-000000000002', c2CompleteWins: 'f27e4100-0000-0000-0000-000000000002', c3CompleteWins: 'f27e4200-0000-0000-0000-000000000002',
  caseClaimRevoked: 'f27e4000-0000-0000-0000-000000000003', c2ClaimRevoked: 'f27e4100-0000-0000-0000-000000000003', c3ClaimRevoked: 'f27e4200-0000-0000-0000-000000000003',
  caseClaimWins: 'f27e4000-0000-0000-0000-000000000004', c2ClaimWins: 'f27e4100-0000-0000-0000-000000000004', c3ClaimWins: 'f27e4200-0000-0000-0000-000000000004',
  caseCutA: 'f27e4000-0000-0000-0000-000000000005', c2CutA: 'f27e4100-0000-0000-0000-000000000005', c3CutA: 'f27e4200-0000-0000-0000-000000000005',
  caseCutB: 'f27e4000-0000-0000-0000-000000000006', c2CutB: 'f27e4100-0000-0000-0000-000000000006', c3CutB: 'f27e4200-0000-0000-0000-000000000006',
  caseForeign: 'f27e4000-0000-0000-0000-000000000007', c2Foreign: 'f27e4100-0000-0000-0000-000000000007', c3Foreign: 'f27e4200-0000-0000-0000-000000000007',
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
function assert(value, message) { if (!value) throw new Error(message) }
async function denied(sql, code) {
  try { await runSql(sql) } catch (error) { assert(String(error).includes(code), `Expected ${code}, got ${error}`); return }
  throw new Error(`Expected denied operation: ${code}`)
}
const inventoryIds = `'${ids.inventoryA}','${ids.inventoryB}'`
const userIds = `'${ids.admin}','${ids.c2}','${ids.c3a}','${ids.c3b}','${ids.c3c}'`
const cleanup = `
delete from public.recount_mission_lifecycle_events where inventory_id in (${inventoryIds});
delete from public.reconciliation_events where inventory_id in (${inventoryIds});
delete from public.recount_subtask_serial_scans where subtask_id in (select id from public.recount_mission_subtasks where inventory_id in (${inventoryIds}));
delete from public.recount_subtask_findings where subtask_id in (select id from public.recount_mission_subtasks where inventory_id in (${inventoryIds}));
delete from public.recount_mission_subtasks where inventory_id in (${inventoryIds});
delete from public.recount_mission_observations where mission_id in (select id from public.recount_missions where inventory_id in (${inventoryIds}));
delete from public.recount_missions where inventory_id in (${inventoryIds});
delete from public.reconciliation_cases where inventory_id in (${inventoryIds});
delete from public.inventory_cuts where inventory_id in (${inventoryIds});
delete from public.inventory_master_items where inventory_id in (${inventoryIds});
delete from public.inventory_assignments where inventory_id in (${inventoryIds});
delete from public.inventories where id in (${inventoryIds});
delete from public.recount_sla_policies where warehouse_id='${ids.warehouseB}';
delete from public.warehouses where id='${ids.warehouseB}';
delete from public.profiles where user_id in (${userIds});
delete from auth.users where id in (${userIds});`

function seedCase(caseId, c2Id, c3Id, inventoryId, suffix, cutId = null, status = 'QUEUED', assignee = null) {
  const cut = cutId ? `'${cutId}'::uuid` : 'null'
  const assigned = assignee ? `'${assignee}'::uuid` : 'null'
  const active = status === 'ACTIVE' ? ',claimed_at' : ''
  const activeValues = status === 'ACTIVE' ? ',now()' : ''
  return `
insert into public.reconciliation_cases(id,inventory_id,codigo,reference_type,anomaly_type,system_quantity,physical_quantity,status,created_by,source_cut_id)
values('${caseId}','${inventoryId}','CUT07E${suffix}','LEGACY','CUT07E',9,7,'REQUIERE_3ER_CONTEO','${ids.admin}',${cut});
insert into public.recount_missions(id,case_id,inventory_id,round,status,assigned_user_id,claimed_at,completed_at,total_quantity,created_by)
values('${c2Id}','${caseId}','${inventoryId}',2,'COMPLETED','${ids.c2}',now(),now(),8,'${ids.admin}');
update public.recount_missions set source_cut_id=${cut} where id='${c2Id}';
insert into public.recount_missions(id,case_id,inventory_id,round,status,assigned_user_id${active},created_by,source_cut_id,source_c2_mission_id)
values('${c3Id}','${caseId}','${inventoryId}',3,'${status}',${assigned}${activeValues},'${ids.c2}',${cut},'${c2Id}');`
}

const setup = `${cleanup}
insert into auth.users(id,aud,role,email,encrypted_password,raw_app_meta_data,raw_user_meta_data,created_at,updated_at) values
 ('${ids.admin}','authenticated','authenticated','cut207e-admin@example.invalid','','{}','{}',now(),now()),
 ('${ids.c2}','authenticated','authenticated','cut207e-c2@example.invalid','','{}','{}',now(),now()),
 ('${ids.c3a}','authenticated','authenticated','cut207e-c3a@example.invalid','','{}','{}',now(),now()),
 ('${ids.c3b}','authenticated','authenticated','cut207e-c3b@example.invalid','','{}','{}',now(),now()),
 ('${ids.c3c}','authenticated','authenticated','cut207e-c3c@example.invalid','','{}','{}',now(),now());
insert into public.profiles(user_id,display_name,role,active,user_type) values
 ('${ids.admin}','CUT207E admin','ADMIN',true,'PERMANENT'),('${ids.c2}','CUT207E C2','CONTADOR',true,'PERMANENT'),
 ('${ids.c3a}','CUT207E C3 A','ANALISTA',true,'PERMANENT'),('${ids.c3b}','CUT207E C3 B','ANALISTA',true,'PERMANENT'),('${ids.c3c}','CUT207E C3 C','ANALISTA',true,'PERMANENT');
insert into public.warehouses(id,code,name,timezone,operational_hours_id) values('${ids.warehouseB}','CUT07E-B','CUT07E warehouse B','America/Santiago','00000000-0000-0000-0000-00000000c201');
insert into public.recount_sla_policies(warehouse_id) values('${ids.warehouseB}');
insert into public.inventories(id,name,status,warehouse_id,created_by,prepared_at,prepared_by,opened_at,opened_by,c1_completed_at,c1_completed_by,c1_count_records,c1_counted_units,c1_master_fingerprint,c1_reference_fingerprint) values
 ('${ids.inventoryA}','CUT207E warehouse A','ABIERTO','00000000-0000-0000-0000-00000000c202','${ids.admin}',now(),'${ids.admin}',now(),'${ids.admin}',now(),'${ids.admin}',0,0,repeat('a',64),repeat('b',64)),
 ('${ids.inventoryB}','CUT207E warehouse B','ABIERTO','${ids.warehouseB}','${ids.admin}',now(),'${ids.admin}',now(),'${ids.admin}',now(),'${ids.admin}',0,0,repeat('a',64),repeat('b',64));
insert into public.inventory_assignments(inventory_id,user_id,assigned_by) values
 ('${ids.inventoryA}','${ids.c2}','${ids.admin}'),('${ids.inventoryA}','${ids.c3a}','${ids.admin}'),('${ids.inventoryA}','${ids.c3b}','${ids.admin}'),('${ids.inventoryA}','${ids.c3c}','${ids.admin}'),
 ('${ids.inventoryB}','${ids.c2}','${ids.admin}');
insert into public.inventory_master_items(inventory_id,codigo,descripcion,control_type,source,created_by) values
 ('${ids.inventoryA}','CUT07E01','C3 local fixture','LEGACY','TEST','${ids.admin}'),('${ids.inventoryB}','CUT07E02','C3 foreign fixture','LEGACY','TEST','${ids.admin}');
insert into public.inventory_cuts(id,inventory_id,cut_number,created_by) values
 ('${ids.cutA}','${ids.inventoryA}',1,'${ids.admin}'),('${ids.cutB}','${ids.inventoryA}',2,'${ids.admin}');
${seedCase(ids.caseCompleteRevoked, ids.c2CompleteRevoked, ids.c3CompleteRevoked, ids.inventoryA, '01', ids.cutA, 'ACTIVE', ids.c3a)}
${seedCase(ids.caseCompleteWins, ids.c2CompleteWins, ids.c3CompleteWins, ids.inventoryA, '02', ids.cutB, 'ACTIVE', ids.c3a)}
${seedCase(ids.caseClaimRevoked, ids.c2ClaimRevoked, ids.c3ClaimRevoked, ids.inventoryA, '03', ids.cutA)}
${seedCase(ids.caseClaimWins, ids.c2ClaimWins, ids.c3ClaimWins, ids.inventoryA, '04', ids.cutB)}
${seedCase(ids.caseCutA, ids.c2CutA, ids.c3CutA, ids.inventoryA, '05', ids.cutA)}
${seedCase(ids.caseCutB, ids.c2CutB, ids.c3CutB, ids.inventoryA, '06', ids.cutB)}
${seedCase(ids.caseForeign, ids.c2Foreign, ids.c3Foreign, ids.inventoryB, '07')}`

const asActor = (actor, sql) => `begin; set local role authenticated; set local request.jwt.claim.sub='${actor}'; ${sql}; commit;`

try {
  const health = spawnSync('docker', ['inspect', '-f', '{{.State.Running}}', container], { encoding: 'utf8' })
  assert(health.status === 0 && health.stdout.trim() === 'true', `Local Supabase database container ${container} is not running`)
  await runSql(setup)

  // Lock order for all C3 mutations is mission -> profile -> assignment -> grant.
  // A direct revocation locks only its target authorization row, so it cannot
  // form a cycle with a mission mutation and the commit order chooses winner.
  await runSql(`update public.profiles set user_type='EXTERNAL_AUDITOR' where user_id='${ids.c3a}';`)
  await denied(asActor(ids.c3a, `select public.complete_my_recount_mission_zero('${ids.c3CompleteRevoked}')`), 'AUTHORIZATION_REVOKED')
  assert(await runSql(`select status||'|'||coalesce(completed_at::text,'') from public.recount_missions where id='${ids.c3CompleteRevoked}'`) === 'ACTIVE|', 'revocation-first completion mutated mission')
  assert(await runSql(`select count(*) from public.reconciliation_events where case_id='${ids.caseCompleteRevoked}' and event_type='THIRD_RECORDED'`) === '0', 'revocation-first emitted completion audit')

  await runSql(`update public.profiles set user_type='PERMANENT' where user_id='${ids.c3a}';`)
  await runSql(asActor(ids.c3a, `select public.complete_my_recount_mission_zero('${ids.c3CompleteWins}')`))
  await runSql(`update public.profiles set user_type='EXTERNAL_AUDITOR' where user_id='${ids.c3a}';`)
  assert((await runSql(`select status from public.recount_missions where id='${ids.c3CompleteWins}'`)) === 'COMPLETED', 'completion-first was reverted by later revocation')
  assert(await runSql(`select count(*) from public.reconciliation_events where case_id='${ids.caseCompleteWins}' and event_type='THIRD_RECORDED'`) === '1', 'completion-first audit is not unique')

  await runSql(`update public.profiles set user_type='EXTERNAL_AUDITOR' where user_id='${ids.c3b}';`)
  await denied(asActor(ids.c3b, `select public.claim_next_recount_mission('${ids.inventoryA}')`), 'CAPABILITY_REQUIRED')
  assert(await runSql(`select count(*) from public.recount_missions where id='${ids.c3ClaimRevoked}' and assigned_user_id is null`) === '1', 'revocation-first claim assigned a C3')
  assert(await runSql(`select count(*) from public.reconciliation_events where case_id='${ids.caseClaimRevoked}' and event_type='THIRD_ASSIGNED'`) === '0', 'revocation-first emitted claim audit')

  await runSql(`update public.profiles set user_type='PERMANENT' where user_id='${ids.c3b}';`)
  await runSql(asActor(ids.c3b, `select public.claim_next_recount_mission('${ids.inventoryA}')`))
  assert(await runSql(`select count(*) from public.recount_missions where id='${ids.c3ClaimRevoked}' and status='ACTIVE' and assigned_user_id='${ids.c3b}'`) === '1', 'claim-first did not assign the queued C3 to its actor')
  await runSql(`update public.profiles set user_type='EXTERNAL_AUDITOR' where user_id='${ids.c3b}';`)
  await denied(asActor(ids.c3b, `select public.complete_my_recount_mission_zero('${ids.c3ClaimRevoked}')`), 'AUTHORIZATION_REVOKED')
  assert(await runSql(`select count(*) from public.recount_missions where id='${ids.c3ClaimRevoked}' and status='ACTIVE' and assigned_user_id='${ids.c3b}'`) === '1', 'claim-first mission became corrupt after revocation')

  // Two independent sessions complete the same active C3. The second session
  // waits on the mission row and cannot emit another finalization event.
  await runSql(`update public.profiles set user_type='PERMANENT' where user_id='${ids.c3a}';`)
  const completeWinner = runSql(asActor(ids.c3a, `select public.complete_my_recount_mission_zero('${ids.c3CompleteRevoked}'); select pg_sleep(2)`))
  await new Promise((resolve) => setTimeout(resolve, 250))
  const completeLoser = runSql(asActor(ids.c3a, `do $$begin perform public.complete_my_recount_mission_zero('${ids.c3CompleteRevoked}'); exception when insufficient_privilege then null; end$$`))
  await Promise.all([completeWinner, completeLoser])
  assert(await runSql(`select count(*) from public.reconciliation_events where case_id='${ids.caseCompleteRevoked}' and event_type='THIRD_RECORDED'`) === '1', 'complete-versus-complete emitted more than one audit')

  // Revocation-first is a genuine lock race: the revocation holds the profile
  // row while completion has already locked the mission and waits for it.
  const c3ForRevokeFirst = ids.c3ClaimWins
  await runSql(asActor(ids.c3a, `select public.claim_next_recount_mission('${ids.inventoryA}')`))
  assert(await runSql(`select count(*) from public.recount_missions where id='${c3ForRevokeFirst}' and assigned_user_id='${ids.c3a}' and status='ACTIVE'`) === '1', 'failed to prepare active C3 for revoke-first race')
  const revokeFirst = runSql(`begin; update public.profiles set user_type='EXTERNAL_AUDITOR' where user_id='${ids.c3a}'; select pg_sleep(2); commit;`)
  await new Promise((resolve) => setTimeout(resolve, 250))
  await denied(asActor(ids.c3a, `select public.complete_my_recount_mission_zero('${c3ForRevokeFirst}')`), 'AUTHORIZATION_REVOKED')
  await revokeFirst
  assert(await runSql(`select status from public.recount_missions where id='${c3ForRevokeFirst}'`) === 'ACTIVE', 'revoke-first completed a C3')

  // Claim-first against revocation is also run with overlapping sessions. The
  // claim is historical once committed, while the later revocation blocks the
  // first subsequent mutation.
  const claimWinner = runSql(asActor(ids.c3c, `select public.claim_next_recount_mission('${ids.inventoryA}'); select pg_sleep(2)`))
  await new Promise((resolve) => setTimeout(resolve, 250))
  const revokeAfterClaim = runSql(`begin; update public.profiles set user_type='EXTERNAL_AUDITOR' where user_id='${ids.c3c}'; commit;`)
  await Promise.all([claimWinner, revokeAfterClaim])
  const claimedByC3c = await runSql(`select id from public.recount_missions where inventory_id='${ids.inventoryA}' and assigned_user_id='${ids.c3c}' and status='ACTIVE'`)
  assert(claimedByC3c !== '', 'claim-first did not retain its committed assignment')
  await denied(asActor(ids.c3c, `select public.complete_my_recount_mission_zero('${claimedByC3c}')`), 'AUTHORIZATION_REVOKED')

  // C3 provenance remains one-to-one and cut-local even when cuts coexist.
  const sourceRows = await runSql(`select id||'|'||source_c2_mission_id||'|'||source_cut_id from public.recount_missions where id in ('${ids.c3CutA}','${ids.c3CutB}') order by id;`)
  assert(sourceRows === `${ids.c3CutA}|${ids.c2CutA}|${ids.cutA}\n${ids.c3CutB}|${ids.c2CutB}|${ids.cutB}`, `multi-cut source chain crossed: ${sourceRows}`)
  assert(await runSql(`select count(*) from public.recount_missions where id='${ids.c3CutB}' and status='QUEUED'`) === '1', 'claiming CUT-A changed CUT-B')

  // One inventory maps to exactly one warehouse in the canonical schema. The
  // two-warehouse test therefore uses two inventories with distinct warehouse
  // scope; a shared warehouse code does not grant cross-inventory access.
  await denied(asActor(ids.c3a, `select public.claim_next_recount_mission('${ids.inventoryB}')`), 'CAPABILITY_REQUIRED')
  await denied(asActor(ids.c3a, `select public.get_live_monitor_missions('${ids.inventoryB}',100)`), 'CAPABILITY_REQUIRED')
  assert(await runSql(`select count(*) from public.recount_missions where id='${ids.c3Foreign}' and assigned_user_id is null`) === '1', 'foreign warehouse/inventory C3 was mutated')

  console.log('PASS CUT2-07E PostgreSQL: complete/revoke and claim/revoke both commit orders, C3 provenance per cut, and scoped warehouse/inventory isolation.')
} finally { await runSql(cleanup).catch(() => {}) }
