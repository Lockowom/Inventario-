/** Local-only CUT2-08J 10k findings probe; it always cleans its fixture. */
import { spawn, spawnSync } from 'node:child_process'

const container = process.env.SUPABASE_DB_CONTAINER ?? 'supabase_db_inven3'
const ids = { admin: 'c8b10000-0000-0000-0000-000000000001', inventoryA: 'c8b20000-0000-0000-0000-000000000001', inventoryB: 'c8b20000-0000-0000-0000-000000000002', warehouseA: '00000000-0000-0000-0000-00000000c202', warehouseB: '00000000-0000-0000-0000-00000000c203' }

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
const assert = (condition, message) => { if (!condition) throw new Error(message) }
const cleanup = `
set session_replication_role=replica;
delete from public.reference_finding_events where finding_id in (select id from public.reference_findings where inventory_id in ('${ids.inventoryA}','${ids.inventoryB}'));
delete from public.finding_evidence where finding_id in (select id from public.reference_findings where inventory_id in ('${ids.inventoryA}','${ids.inventoryB}'));
delete from public.reference_findings where inventory_id in ('${ids.inventoryA}','${ids.inventoryB}');
delete from public.inventories where id in ('${ids.inventoryA}','${ids.inventoryB}');
delete from public.warehouses where id='${ids.warehouseB}';
delete from public.profiles where user_id='${ids.admin}';
delete from auth.users where id='${ids.admin}';
set session_replication_role=origin;`
const explain = (name, query) => `\\echo ${name}\nexplain (analyze,buffers,format text) ${query};`

try {
  const health = spawnSync('docker', ['inspect', '-f', '{{.State.Running}}', container], { encoding: 'utf8' })
  assert(health.status === 0 && health.stdout.trim() === 'true', 'Local Supabase PostgreSQL is not running')
  await runSql(cleanup)
  await runSql(`
insert into auth.users(id,aud,role,email,encrypted_password,raw_app_meta_data,raw_user_meta_data,created_at,updated_at) values('${ids.admin}','authenticated','authenticated','cut208-performance@example.invalid','','{}','{}',now(),now());
insert into public.profiles(user_id,display_name,role,user_type,active) values('${ids.admin}','CUT2-08 performance admin','ADMIN','PERMANENT',true);
insert into public.warehouses(id,code,name,timezone,operational_hours_id,active) values('${ids.warehouseB}','PERF-C08-B','CUT2-08 performance warehouse B','America/Santiago','00000000-0000-0000-0000-00000000c201',true);
insert into public.inventories(id,name,status,warehouse_id,created_by,prepared_at,prepared_by,opened_at,opened_by) values
 ('${ids.inventoryA}','CUT2-08 performance A','ABIERTO','${ids.warehouseA}','${ids.admin}',now(),'${ids.admin}',now(),'${ids.admin}'),
 ('${ids.inventoryB}','CUT2-08 performance B','ABIERTO','${ids.warehouseB}','${ids.admin}',now(),'${ids.admin}',now(),'${ids.admin}');
insert into public.reference_findings(inventory_id,warehouse_id,reference_type,normalized_reference_key,finding_type,state,critical,description,created_by,severity,source_stage,resolved_by,resolved_at,resolution,resolution_code,created_at)
select case when g % 2=0 then '${ids.inventoryA}'::uuid else '${ids.inventoryB}'::uuid end,
  case when g % 2=0 then '${ids.warehouseA}'::uuid else '${ids.warehouseB}'::uuid end,
  'LEGACY'::public.master_control_type,'PERF-' || (g % 1000)::text,'OTHER'::public.cut2_finding_type,
  case when g % 3=0 then 'RESOLVED'::public.cut2_finding_state else 'OPEN'::public.cut2_finding_state end,
  g % 10=0,'Synthetic local CUT2-08 performance finding ' || g::text,'${ids.admin}'::uuid,
  case when g % 10=0 then 'CRITICAL'::public.cut2_finding_severity when g % 5=0 then 'HIGH'::public.cut2_finding_severity else 'MEDIUM'::public.cut2_finding_severity end,
  case when g % 7=0 then 'OFFLINE_LATE_COUNT'::public.cut2_finding_source_stage when g % 5=0 then 'POST_SEAL'::public.cut2_finding_source_stage when g % 11=0 then 'C3'::public.cut2_finding_source_stage when g % 13=0 then 'C2'::public.cut2_finding_source_stage else 'PRE_SEAL'::public.cut2_finding_source_stage end,
  case when g % 3=0 then '${ids.admin}'::uuid else null end,case when g % 3=0 then now() else null end,
  case when g % 3=0 then 'Synthetic resolved decision' else null end,case when g % 3=0 then 'NO_ADJUSTMENT_REQUIRED'::public.cut2_finding_resolution_code else null end,
  now() - (g || ' seconds')::interval from generate_series(1,10000) g;
analyze public.reference_findings;`)
  const output = await runSql(`
${explain('OPEN_FINDINGS_LIST', `select id from public.reference_findings where inventory_id='${ids.inventoryA}' and warehouse_id='${ids.warehouseA}' and state in ('OPEN','HELD') order by severity,created_at desc limit 100`)}
${explain('CRITICAL_IDENTITY_BLOCKER', `select id from public.reference_findings where inventory_id='${ids.inventoryA}' and warehouse_id='${ids.warehouseA}' and reference_type='LEGACY' and normalized_reference_key='PERF-10' and state in ('OPEN','HELD') and critical`)}
${explain('SEAL_BLOCKER', `select id from public.reference_findings where inventory_id='${ids.inventoryA}' and warehouse_id='${ids.warehouseA}' and state in ('OPEN','HELD') and blocks_seal`)}
${explain('RP_BLOCKER', `select id from public.reference_findings where inventory_id='${ids.inventoryA}' and state in ('OPEN','HELD') and blocks_rp`)}
${explain('FINDING_DETAIL', `select f.*, e.id as evidence_id from public.reference_findings f left join public.finding_evidence e on e.finding_id=f.id where f.inventory_id='${ids.inventoryA}' order by f.created_at desc limit 1`)}
${explain('TIMELINE', `select e.* from public.reference_finding_events e join public.reference_findings f on f.id=e.finding_id where f.inventory_id='${ids.inventoryA}' order by e.created_at desc limit 100`)}`)
  console.log(output)
  console.log('PASS CUT2-08 local performance dataset: 10000 synthetic findings created, analyzed, and explained; no index was added by this probe.')
} finally {
  await runSql(cleanup).catch(() => {})
}
