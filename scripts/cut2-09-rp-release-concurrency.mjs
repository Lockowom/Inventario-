/**
 * CUT2-09B3 local PostgreSQL concurrency proof.
 *
 * The three release-first cases use separate libpq clients plus an explicit
 * advisory gate.  Session A owns the selected sealed-reference row and waits
 * at the gate. Session B is observed waiting on that same PostgreSQL lock
 * before the gate is released.  Therefore the order is proved by locks, not
 * by a timer: release commits first and the later blocker/C2/C3 state cannot
 * mutate its immutable snapshot.
 */
import { randomUUID } from 'node:crypto'
import { spawn, spawnSync } from 'node:child_process'

const container = process.env.SUPABASE_DB_CONTAINER ?? 'supabase_db_inven3'
const warehouse = '00000000-0000-0000-0000-00000000c202'
const ids = { actor: randomUUID(), inventory: randomUUID() }
const gate = 2090909

function assert(value, message) { if (!value) throw new Error(message) }
function quote(value) { return `'${String(value).replaceAll("'", "''")}'` }
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
const asActor = (sql) => `begin; set local role authenticated; set local request.jwt.claim.sub=${quote(ids.actor)}; ${sql}; commit;`
async function denied(sql, code) {
  try { await runSql(sql) } catch (error) {
    assert(String(error).includes(code), `Expected ${code}, got ${error}`)
    return
  }
  throw new Error(`Expected denial ${code}`)
}

function interactiveSql() {
  const child = spawn('docker', ['exec', '-i', container, 'psql', '-U', 'postgres', '-d', 'postgres', '-v', 'ON_ERROR_STOP=1', '-Atq'], { stdio: ['pipe', 'pipe', 'pipe'] })
  let stdout = ''; let stderr = ''; let closed = false
  child.stdout.on('data', (chunk) => { stdout += chunk })
  child.stderr.on('data', (chunk) => { stderr += chunk })
  const done = new Promise((resolve, reject) => {
    child.on('error', reject)
    child.on('close', (code) => {
      closed = true
      if (code === 0) resolve(stdout.trim())
      else reject(new Error(stderr || `psql exited ${code}`))
    })
  })
  return {
    send(sql) { child.stdin.write(`${sql}\n`) },
    async marker(marker) {
      const deadline = Date.now() + 5000
      while (!stdout.includes(marker)) {
        if (closed) throw new Error(`Session closed before marker ${marker}: ${stderr}`)
        if (Date.now() > deadline) throw new Error(`Timed out waiting for marker ${marker}: ${stdout} ${stderr}`)
        // This bounded state observer never determines ordering; PostgreSQL
        // row/advisory locks are the synchronization primitive.
        await new Promise((resolve) => setTimeout(resolve, 20))
      }
    },
    finish() { child.stdin.end('\\q\n'); return done },
  }
}
async function waitForLock(applicationName) {
  const deadline = Date.now() + 5000
  while (Date.now() <= deadline) {
    const waiting = await runSql(`select count(*) from pg_stat_activity where application_name=${quote(applicationName)} and wait_event_type='Lock'`)
    if (waiting === '1') return
    await new Promise((resolve) => setTimeout(resolve, 20))
  }
  throw new Error(`Session ${applicationName} never reached the PostgreSQL lock barrier`)
}

const cleanup = `
set session_replication_role=replica;
delete from public.rp_release_audits where inventory_id=${quote(ids.inventory)};
delete from public.rp_release_batches where inventory_id=${quote(ids.inventory)};
delete from public.reference_finding_events where finding_id in (select id from public.reference_findings where inventory_id=${quote(ids.inventory)});
delete from public.finding_evidence where finding_id in (select id from public.reference_findings where inventory_id=${quote(ids.inventory)});
delete from public.reference_findings where inventory_id=${quote(ids.inventory)};
delete from public.recount_missions where inventory_id=${quote(ids.inventory)};
delete from public.reconciliation_cases where inventory_id=${quote(ids.inventory)};
delete from public.inventory_sealed_references where inventory_id=${quote(ids.inventory)};
delete from public.inventory_master_items where inventory_id=${quote(ids.inventory)};
delete from public.inventory_assignments where inventory_id=${quote(ids.inventory)};
delete from public.inventories where id=${quote(ids.inventory)};
delete from public.profiles where user_id=${quote(ids.actor)};
delete from auth.users where id=${quote(ids.actor)};
set session_replication_role=origin;`

async function seedReference(label) {
  const reference = randomUUID()
  await runSql(`insert into public.inventory_master_items(inventory_id,codigo,descripcion,control_type,source,created_by)
    values (${quote(ids.inventory)},${quote(label)},'CUT2-09 race identity','LEGACY','TEST',${quote(ids.actor)});
    insert into public.inventory_sealed_references(id,inventory_id,warehouse_id,reference_type,codigo,normalized_reference_key,state,request_id,physical_quantity,sealed_at,sealed_by)
    values (${quote(reference)},${quote(ids.inventory)},${quote(warehouse)},'LEGACY',${quote(label)},public.normalize_reference_key('LEGACY',${quote(label)},null),'SEALED',${quote(randomUUID())},1,now(),${quote(ids.actor)});`)
  return { reference, label }
}
async function preview(reference) {
  const value = await runSql(asActor(`select public.preview_rp_release(${quote(ids.inventory)},${quote(warehouse)},array[${quote(reference)}::uuid])->>'fingerprint'`))
  assert(/^[a-f0-9]{64}$/.test(value), `invalid preview fingerprint ${value}`)
  return value
}
function createSql(reference, fingerprint, request) {
  return `select public.create_rp_release(${quote(ids.inventory)},${quote(warehouse)},array[${quote(reference)}::uuid],${quote(fingerprint)},${quote(request)}::uuid)`
}
function blockerSql(reference, label) {
  return `select public.report_c1_reference_finding(${quote(ids.inventory)},'LEGACY',${quote(label)},null,'OTHER','concurrent RP blocker',true,${quote(`c09-race-${reference}`)},now(),false,jsonb_build_object('note','concurrent blocker'))`
}
function c2Sql(reference, label) {
  const caseId = randomUUID(); const mission = randomUUID()
  return `insert into public.reconciliation_cases(id,inventory_id,codigo,reference_type,anomaly_type,system_quantity,physical_quantity,status,created_by)
    values (${quote(caseId)},${quote(ids.inventory)},${quote(label)},'LEGACY','CUT2_09_RACE',1,0,'REQUIERE_2DO_CONTEO',${quote(ids.actor)});
    insert into public.recount_missions(id,case_id,inventory_id,round,status,created_by,source_sealed_reference_id)
    values (${quote(mission)},${quote(caseId)},${quote(ids.inventory)},2,'QUEUED',${quote(ids.actor)},${quote(reference)})`
}
function c3Sql(reference, label) {
  const caseId = randomUUID(); const c2 = randomUUID(); const c3 = randomUUID()
  return `insert into public.reconciliation_cases(id,inventory_id,codigo,reference_type,anomaly_type,system_quantity,physical_quantity,status,created_by)
    values (${quote(caseId)},${quote(ids.inventory)},${quote(label)},'LEGACY','CUT2_09_RACE',1,0,'REQUIERE_3ER_CONTEO',${quote(ids.actor)});
    insert into public.recount_missions(id,case_id,inventory_id,round,status,assigned_user_id,claimed_at,completed_at,total_quantity,created_by,source_sealed_reference_id)
    values (${quote(c2)},${quote(caseId)},${quote(ids.inventory)},2,'COMPLETED',${quote(ids.actor)},now(),now(),1,${quote(ids.actor)},${quote(reference)});
    insert into public.recount_missions(id,case_id,inventory_id,round,status,created_by,source_sealed_reference_id,source_c2_mission_id)
    values (${quote(c3)},${quote(caseId)},${quote(ids.inventory)},3,'QUEUED',${quote(ids.actor)},${quote(reference)},${quote(c2)})`
}

async function blockerFirst(kind, writer) {
  const { reference, label } = await seedReference(`C09-${kind}-FIRST`)
  const fingerprint = await preview(reference)
  await runSql(kind === 'BLOCKER' ? asActor(blockerSql(reference, label)) : writer(reference, label))
  await denied(asActor(createSql(reference, fingerprint, randomUUID())), kind === 'BLOCKER' ? 'PREVIEW_STALE' : 'PREVIEW_STALE')
  assert(await runSql(`select count(*) from public.rp_release_batches where inventory_id=${quote(ids.inventory)} and policy_snapshot->>'preview_fingerprint'=${quote(fingerprint)}`) === '0', `${kind}-first made a partial release`)
}

async function releaseFirstRace(kind, writer) {
  const { reference, label } = await seedReference(`C09-${kind}-RACE`)
  const fingerprint = await preview(reference); const request = randomUUID(); const appName = `cut2-09-${kind.toLowerCase()}-${randomUUID()}`
  const gateSession = interactiveSql()
  gateSession.send(`begin; select pg_advisory_xact_lock(${gate}); select 'GATE_HELD';`)
  await gateSession.marker('GATE_HELD')
  const release = interactiveSql()
  // The direct lock is a privileged test barrier only: production callers
  // cannot UPDATE sealed references.  The writer invocation that follows is
  // still made as the authenticated scoped actor and re-runs all production
  // authorization and validation.
  release.send(`begin; select id from public.inventories where id=${quote(ids.inventory)} for update; select id from public.inventory_sealed_references where id=${quote(reference)} for update; select 'RELEASE_REFERENCE_LOCKED'; select pg_advisory_xact_lock(${gate}); set local role authenticated; set local request.jwt.claim.sub=${quote(ids.actor)}; ${createSql(reference, fingerprint, request)}; commit;`)
  await release.marker('RELEASE_REFERENCE_LOCKED')
  const writerSession = interactiveSql()
  writerSession.send(`begin; set application_name=${quote(appName)}; ${kind === 'BLOCKER' ? `set local role authenticated; set local request.jwt.claim.sub=${quote(ids.actor)}; ${blockerSql(reference, label)}` : writer(reference, label)}; commit;`)
  await waitForLock(appName)
  gateSession.send('commit;')
  await gateSession.finish()
  await Promise.all([release.finish(), writerSession.finish()])
  const releaseRow = await runSql(`select count(*) from public.rp_release_batches where inventory_id=${quote(ids.inventory)} and request_id=${quote(request)}`)
  const audit = await runSql(`select count(*) from public.rp_release_audits a join public.rp_release_batches b on b.id=a.release_id where b.inventory_id=${quote(ids.inventory)} and b.request_id=${quote(request)}`)
  assert(releaseRow === '1' && audit === '1', `${kind} release-first did not retain one immutable release/audit`)
  assert(await runSql(`select policy_snapshot->>'preview_fingerprint' from public.rp_release_batches where inventory_id=${quote(ids.inventory)} and request_id=${quote(request)}`) === fingerprint, `${kind} later mutation changed historical fingerprint`)
}

try {
  const health = spawnSync('docker', ['inspect', '-f', '{{.State.Running}}', container], { encoding: 'utf8' })
  assert(health.status === 0 && health.stdout.trim() === 'true', `Local Supabase container ${container} is not running`)
  await runSql(`insert into auth.users(id,aud,role,email,encrypted_password,raw_app_meta_data,raw_user_meta_data,created_at,updated_at)
    values (${quote(ids.actor)},'authenticated','authenticated',${quote(`cut209-race-${ids.actor}@example.invalid`)},'','{}','{}',now(),now());
    insert into public.profiles(user_id,display_name,role,user_type,active) values (${quote(ids.actor)},'CUT2-09 race analyst','ANALISTA','PERMANENT',true);
    insert into public.inventories(id,name,status,warehouse_id,created_by,prepared_at,prepared_by,opened_at,opened_by)
    values (${quote(ids.inventory)},'CUT2-09 release races','ABIERTO',${quote(warehouse)},${quote(ids.actor)},now(),${quote(ids.actor)},now(),${quote(ids.actor)});
    insert into public.inventory_assignments(inventory_id,user_id,assigned_by) values (${quote(ids.inventory)},${quote(ids.actor)},${quote(ids.actor)});`)

  await blockerFirst('BLOCKER', null)
  await blockerFirst('C2', c2Sql)
  await blockerFirst('C3', c3Sql)
  await releaseFirstRace('BLOCKER', null)
  await releaseFirstRace('C2', c2Sql)
  await releaseFirstRace('C3', c3Sql)
  console.log('PASS CUT2-09 PostgreSQL: blocker/C2/C3 first reject stale preview; release-first locks selected references, commits one immutable release/audit, then admits the later dependent fact.')
} finally {
  await runSql(cleanup).catch(() => {})
}
