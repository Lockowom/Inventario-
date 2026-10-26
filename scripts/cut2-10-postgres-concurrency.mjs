/**
 * CUT2-10B local-only close proof. Every invocation of runSql owns a distinct
 * psql connection, so the close race exercises PostgreSQL row locks rather
 * than a client-side mutex.
 */
import { spawn, spawnSync } from 'node:child_process'
import { randomUUID } from 'node:crypto'

const container = process.env.SUPABASE_DB_CONTAINER ?? 'supabase_db_inven3'
const ids = {
  actor: randomUUID(),
  inventory: randomUUID(),
  requestA: randomUUID(),
  requestB: randomUUID(),
  requestC: randomUUID(),
  c2Case: randomUUID(),
  c2Mission: randomUUID(),
  c3Case: randomUUID(),
  c3Source: randomUUID(),
  c3Mission: randomUUID(),
  rpReference: randomUUID(),
  rpCreateRequest: randomUUID(),
  rpReadyRequest: randomUUID(),
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
async function denied(promise, expected) {
  try { await promise } catch (error) {
    assert(String(error).includes(expected), `Expected ${expected}, got ${error}`)
    return
  }
  throw new Error(`Expected denial ${expected}`)
}
const asActor = (sql) => `begin; set local role authenticated; set local request.jwt.claim.sub='${ids.actor}'; ${sql}; commit;`
const cleanup = `
set session_replication_role = replica;
delete from public.audit_events where inventory_id='${ids.inventory}';
delete from public.inventory_close_requests where inventory_id='${ids.inventory}';
delete from public.rp_release_events where inventory_id='${ids.inventory}';
delete from public.rp_release_discards where release_id in (select id from public.rp_release_batches where inventory_id='${ids.inventory}');
delete from public.rp_release_rectifications where original_release_id in (select id from public.rp_release_batches where inventory_id='${ids.inventory}') or superseding_release_id in (select id from public.rp_release_batches where inventory_id='${ids.inventory}');
delete from public.rp_release_audits where inventory_id='${ids.inventory}';
delete from public.rp_release_batches where inventory_id='${ids.inventory}';
delete from public.recount_missions where inventory_id='${ids.inventory}';
delete from public.reconciliation_cases where inventory_id='${ids.inventory}';
delete from public.preseal_guard_events where inventory_id='${ids.inventory}';
delete from public.finding_evidence where finding_id in (select id from public.reference_findings where inventory_id='${ids.inventory}');
delete from public.reference_finding_events where finding_id in (select id from public.reference_findings where inventory_id='${ids.inventory}');
delete from public.reference_findings where inventory_id='${ids.inventory}';
delete from public.inventory_system_reference_items where inventory_id='${ids.inventory}';
delete from public.inventory_master_items where inventory_id='${ids.inventory}';
delete from public.inventory_sealed_references where inventory_id='${ids.inventory}';
delete from public.inventory_assignments where inventory_id='${ids.inventory}';
delete from public.inventories where id='${ids.inventory}';
delete from public.profiles where user_id='${ids.actor}';
delete from auth.users where id='${ids.actor}';
set session_replication_role = origin;`
const setup = `${cleanup}
insert into auth.users(id,aud,role,email,encrypted_password,raw_app_meta_data,raw_user_meta_data,created_at,updated_at)
values ('${ids.actor}','authenticated','authenticated','cut210-close@example.invalid','','{}','{}',now(),now());
insert into public.profiles(user_id,display_name,role,user_type,active)
values ('${ids.actor}','CUT2-10 closer','ANALISTA','PERMANENT',true);
insert into public.inventories(id,name,status,warehouse_id,created_by,prepared_at,prepared_by,opened_at,opened_by,c1_completed_at,c1_completed_by,c1_count_records,c1_counted_units,c1_master_fingerprint,c1_reference_fingerprint)
values ('${ids.inventory}','CUT2-10 close race','ABIERTO','00000000-0000-0000-0000-00000000c202','${ids.actor}',now(),'${ids.actor}',now(),'${ids.actor}',now(),'${ids.actor}',0,0,'cut210-master','cut210-reference');
insert into public.inventory_assignments(inventory_id,user_id,assigned_by)
values ('${ids.inventory}','${ids.actor}','${ids.actor}');
insert into public.inventory_master_items(inventory_id,codigo,descripcion,control_type,source,created_by)
values ('${ids.inventory}','C10-CLOSE-RACE','CUT2-10 close/finding race identity','LEGACY','CUT2-10','${ids.actor}');
insert into public.inventory_system_reference_items(inventory_id,codigo,reference_type,quantity,source_total_quantity,source_available_quantity,unit_code)
values ('${ids.inventory}','C10-CLOSE-RACE','LEGACY',1,1,1,'UN');`

const createBlockingFinding = (description) => asActor(`select public.create_preseal_reference_finding('${ids.inventory}','LEGACY','C10-CLOSE-RACE','OTHER','${description}',true)`)
const setupWithSealedReference = `${setup}
insert into public.inventory_sealed_references(id,inventory_id,warehouse_id,reference_type,codigo,normalized_reference_key,state,request_id,physical_quantity,sealed_at,sealed_by)
values ('${ids.rpReference}','${ids.inventory}','00000000-0000-0000-0000-00000000c202','LEGACY','C10-RP',public.normalize_reference_key('LEGACY','C10-RP',null),'SEALED','ca980000-0000-0000-0000-000000000001',1,now(),'${ids.actor}');`

try {
  const health = spawnSync('docker', ['inspect', '-f', '{{.State.Running}}', container], { encoding: 'utf8' })
  assert(health.status === 0 && health.stdout.trim() === 'true', 'Local Supabase PostgreSQL is not running')
  await runSql(setup)
  const preview = await runSql(asActor(`select public.preview_inventory_close('${ids.inventory}')`))
  const fingerprint = JSON.parse(preview).fingerprint
  const closeA = runSql(asActor(`select public.close_inventory_final('${ids.inventory}','${fingerprint}','${ids.requestA}'); select pg_sleep(1);`))
  await new Promise((resolve) => setTimeout(resolve, 150))
  const closeB = runSql(asActor(`select public.close_inventory_final('${ids.inventory}','${fingerprint}','${ids.requestB}')`))
  await Promise.all([closeA, denied(closeB, 'INVENTORY_ALREADY_CLOSED')])
  assert(await runSql(`select status::text from public.inventories where id='${ids.inventory}'`) === 'CERRADO', 'winner did not close the inventory')
  assert(await runSql(`select count(*) from public.inventory_close_requests where inventory_id='${ids.inventory}' and state='COMPLETED'`) === '1', 'close/close created more than one completed request')
  assert(await runSql(`select count(*) from public.audit_events where inventory_id='${ids.inventory}' and event_type='INVENTORY_CLOSED'`) === '1', 'close/close created more than one close audit')
  await denied(runSql(`insert into public.recount_missions(case_id,inventory_id,round,status,created_by) values (gen_random_uuid(),'${ids.inventory}',2,'QUEUED','${ids.actor}')`), 'INVENTORY_CLOSED')
  // C3 enforces its source-chain eligibility before the generic close guard;
  // either way an arbitrary post-close C3 cannot be created.
  await denied(runSql(`insert into public.recount_missions(case_id,inventory_id,round,status,created_by) values (gen_random_uuid(),'${ids.inventory}',3,'QUEUED','${ids.actor}')`), 'C3_NOT_ELIGIBLE')
  await denied(runSql(`insert into public.rp_release_batches(inventory_id,warehouse_id,created_by,state) values ('${ids.inventory}','00000000-0000-0000-0000-00000000c202','${ids.actor}','DRAFT')`), 'INVENTORY_CLOSED')

  // Finding commits first: the close writer locks the inventory and recomputes
  // its material fingerprint, so a preview taken before the real blocker can
  // never close it partially.
  await runSql(setup)
  const findingFirstPreview = JSON.parse(await runSql(asActor(`select public.preview_inventory_close('${ids.inventory}')`)))
  await runSql(createBlockingFinding('critical finding commits before close'))
  await denied(runSql(asActor(`select public.close_inventory_final('${ids.inventory}','${findingFirstPreview.fingerprint}','${ids.requestC}')`)), 'PREVIEW_STALE')
  assert(await runSql(`select status::text from public.inventories where id='${ids.inventory}'`) === 'ABIERTO', 'finding-first close changed lifecycle')
  assert(await runSql(`select count(*) from public.inventory_close_requests where inventory_id='${ids.inventory}'`) === '0', 'finding-first close wrote a partial request')
  assert(await runSql(`select count(*) from public.audit_events where inventory_id='${ids.inventory}' and event_type='INVENTORY_CLOSED'`) === '0', 'finding-first close emitted a partial audit')

  // C2 commits first.  The mission and its reconciliation case are ordinary
  // persisted operational rows; the close writer detects their material
  // change and rejects the stale preview before it can write lifecycle state.
  await runSql(setup)
  const c2FirstPreview = JSON.parse(await runSql(asActor(`select public.preview_inventory_close('${ids.inventory}')`)))
  await runSql(`insert into public.reconciliation_cases(id,inventory_id,codigo,reference_type,anomaly_type,system_quantity,physical_quantity,status,created_by)
    values ('${ids.c2Case}','${ids.inventory}','C10-CLOSE-RACE','LEGACY','C10-C2',1,2,'REQUIERE_2DO_CONTEO','${ids.actor}');
    insert into public.recount_missions(id,case_id,inventory_id,round,status,created_by)
    values ('${ids.c2Mission}','${ids.c2Case}','${ids.inventory}',2,'QUEUED','${ids.actor}');`)
  await denied(runSql(asActor(`select public.close_inventory_final('${ids.inventory}','${c2FirstPreview.fingerprint}','${ids.requestC}')`)), 'PREVIEW_STALE')
  assert(await runSql(`select status::text from public.inventories where id='${ids.inventory}'`) === 'ABIERTO', 'C2-first close changed lifecycle')
  assert(await runSql(`select count(*) from public.audit_events where inventory_id='${ids.inventory}' and event_type='INVENTORY_CLOSED'`) === '0', 'C2-first close emitted a partial audit')

  // C3 commits first using the production C3 source-chain trigger.  A
  // completed C2 source is persisted first; inserting C3 derives
  // source_c2_mission_id rather than accepting a fabricated C3 state.
  await runSql(setup)
  const c3FirstPreview = JSON.parse(await runSql(asActor(`select public.preview_inventory_close('${ids.inventory}')`)))
  await runSql(`insert into public.reconciliation_cases(id,inventory_id,codigo,reference_type,anomaly_type,system_quantity,physical_quantity,status,created_by)
    values ('${ids.c3Case}','${ids.inventory}','C10-CLOSE-RACE','LEGACY','C10-C3',1,2,'REQUIERE_3ER_CONTEO','${ids.actor}');
    insert into public.recount_missions(id,case_id,inventory_id,round,status,assigned_user_id,claimed_at,completed_at,total_quantity,created_by)
    values ('${ids.c3Source}','${ids.c3Case}','${ids.inventory}',2,'COMPLETED','${ids.actor}',now(),now(),2,'${ids.actor}');
    insert into public.recount_missions(id,case_id,inventory_id,round,status,created_by)
    values ('${ids.c3Mission}','${ids.c3Case}','${ids.inventory}',3,'QUEUED','${ids.actor}');`)
  assert(await runSql(`select source_c2_mission_id::text from public.recount_missions where id='${ids.c3Mission}'`) === ids.c3Source, 'C3 fixture did not derive its completed C2 source chain')
  await denied(runSql(asActor(`select public.close_inventory_final('${ids.inventory}','${c3FirstPreview.fingerprint}','${ids.requestC}')`)), 'PREVIEW_STALE')
  assert(await runSql(`select status::text from public.inventories where id='${ids.inventory}'`) === 'ABIERTO', 'C3-first close changed lifecycle')
  assert(await runSql(`select count(*) from public.audit_events where inventory_id='${ids.inventory}' and event_type='INVENTORY_CLOSED'`) === '0', 'C3-first close emitted a partial audit')

  // A real RP DRAFT becomes READY through the CUT2-09 writer, then closes
  // only after readiness recomputes its RP coverage.  No release is forged.
  await runSql(setupWithSealedReference)
  const rpPreview = JSON.parse(await runSql(asActor(`select public.preview_rp_release('${ids.inventory}','00000000-0000-0000-0000-00000000c202',array['${ids.rpReference}'::uuid])`)))
  const rpRelease = JSON.parse(await runSql(asActor(`select public.create_rp_release('${ids.inventory}','00000000-0000-0000-0000-00000000c202',array['${ids.rpReference}'::uuid],'${rpPreview.fingerprint}','${ids.rpCreateRequest}')`)))
  const rpReady = JSON.parse(await runSql(asActor(`select public.mark_rp_release_ready('${rpRelease.release_id}','${ids.rpReadyRequest}')`)))
  assert(rpReady.state === 'READY', 'RP fixture did not reach READY through the canonical RPC')
  const rpCoveredClose = JSON.parse(await runSql(asActor(`select public.preview_inventory_close('${ids.inventory}')`)))
  assert(rpCoveredClose.is_ready === true, 'READY RP coverage did not clear the close blocker')
  await runSql(asActor(`select public.close_inventory_final('${ids.inventory}','${rpCoveredClose.fingerprint}','${ids.requestA}')`))
  assert(await runSql(`select status::text from public.inventories where id='${ids.inventory}'`) === 'CERRADO', 'RP-covered close did not transition lifecycle')

  // Close commits first: the pre-seal route is rejected.  Dedicated late
  // offline evidence remains governed by its own REVIEW_REQUIRED intake.
  await runSql(setup)
  const closeFirstPreview = JSON.parse(await runSql(asActor(`select public.preview_inventory_close('${ids.inventory}')`)))
  await runSql(asActor(`select public.close_inventory_final('${ids.inventory}','${closeFirstPreview.fingerprint}','${ids.requestA}')`))
  await denied(runSql(createBlockingFinding('pre-seal finding reported after close')), 'INVENTORY_CLOSED')
  assert(await runSql(`select status::text from public.inventories where id='${ids.inventory}'`) === 'CERRADO', 'post-close pre-seal finding reopened inventory')
  assert(await runSql(`select count(*) from public.inventory_close_requests where inventory_id='${ids.inventory}' and state='COMPLETED'`) === '1', 'post-close finding altered completed close request')
  assert(await runSql(`select count(*) from public.audit_events where inventory_id='${ids.inventory}' and event_type='INVENTORY_CLOSED'`) === '1', 'post-close finding altered close audit history')
  assert(await runSql(`select count(*) from public.reference_findings where inventory_id='${ids.inventory}'`) === '0', 'post-close pre-seal finding was persisted')
  console.log('PASS CUT2-10 PostgreSQL concurrency: close/close is unique; finding/C2/C3 changes invalidate stale close previews; READY RP coverage permits close; post-close C2/C3/RP and pre-seal finding writes are rejected.')
} finally {
  await runSql(cleanup).catch(() => {})
}
