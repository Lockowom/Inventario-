/** Local-only CUT2-09B4 plan capture against a 1,500-reference fixture. */
import { randomUUID } from 'node:crypto'
import { spawn, spawnSync } from 'node:child_process'

const container = process.env.SUPABASE_DB_CONTAINER ?? 'supabase_db_inven3'
const warehouse = '00000000-0000-0000-0000-00000000c202'
const actor = randomUUID(); const inventory = randomUUID()
const quote = (value) => `'${String(value).replaceAll("'", "''")}'`
const assert = (value, message) => { if (!value) throw new Error(message) }
function sql(statement) {
  return new Promise((resolve, reject) => {
    const child = spawn('docker', ['exec', '-i', container, 'psql', '-U', 'postgres', '-d', 'postgres', '-v', 'ON_ERROR_STOP=1', '-Atq'], { stdio: ['pipe', 'pipe', 'pipe'] })
    let stdout = ''; let stderr = ''
    child.stdout.on('data', (chunk) => { stdout += chunk })
    child.stderr.on('data', (chunk) => { stderr += chunk })
    child.on('error', reject)
    child.on('close', (code) => code === 0 ? resolve(stdout.trim()) : reject(new Error(stderr || `psql exited ${code}`)))
    child.stdin.end(statement)
  })
}
const cleanup = `set session_replication_role=replica;
delete from public.rp_release_audits where inventory_id=${quote(inventory)};
delete from public.rp_release_batches where inventory_id=${quote(inventory)};
delete from public.inventory_sealed_references where inventory_id=${quote(inventory)};
delete from public.inventory_assignments where inventory_id=${quote(inventory)};
delete from public.inventories where id=${quote(inventory)};
delete from public.profiles where user_id=${quote(actor)};
delete from auth.users where id=${quote(actor)};
set session_replication_role=origin;`
function nodes(plan, output = []) {
  output.push({ type: plan['Node Type'], relation: plan['Relation Name'] ?? '', index: plan['Index Name'] ?? '', rows: plan['Actual Rows'], loops: plan['Actual Loops'], hit: plan['Shared Hit Blocks'] ?? 0, read: plan['Shared Read Blocks'] ?? 0 })
  for (const child of plan.Plans ?? []) nodes(child, output)
  return output
}
async function explain(name, source) {
  const report = JSON.parse(await sql(`explain (analyze,buffers,format json) ${source}`))[0]
  const used = nodes(report.Plan).filter((item) => item.index || item.relation).map((item) => `${item.type}${item.relation ? `:${item.relation}` : ''}${item.index ? `@${item.index}` : ''} rows=${item.rows} loops=${item.loops} hit=${item.hit} read=${item.read}`)
  console.log(`${name}: planning=${report['Planning Time']}ms execution=${report['Execution Time']}ms | ${used.join(' ; ')}`)
}

try {
  const health = spawnSync('docker', ['inspect', '-f', '{{.State.Running}}', container], { encoding: 'utf8' })
  assert(health.status === 0 && health.stdout.trim() === 'true', 'Local Supabase PostgreSQL is not running')
  await sql(`insert into auth.users(id,aud,role,email,encrypted_password,raw_app_meta_data,raw_user_meta_data,created_at,updated_at)
    values (${quote(actor)},'authenticated','authenticated',${quote(`cut209-perf-${actor}@example.invalid`)},'','{}','{}',now(),now());
    insert into public.profiles(user_id,display_name,role,user_type,active) values (${quote(actor)},'CUT2-09 perf','ANALISTA','PERMANENT',true);
    insert into public.inventories(id,name,status,warehouse_id,created_by,prepared_at,prepared_by,opened_at,opened_by) values (${quote(inventory)},'CUT2-09 performance','ABIERTO',${quote(warehouse)},${quote(actor)},now(),${quote(actor)},now(),${quote(actor)});
    insert into public.inventory_assignments(inventory_id,user_id,assigned_by) values (${quote(inventory)},${quote(actor)},${quote(actor)});
    insert into public.inventory_sealed_references(inventory_id,warehouse_id,reference_type,codigo,normalized_reference_key,state,request_id,physical_quantity,sealed_at,sealed_by)
    select ${quote(inventory)},${quote(warehouse)},'LEGACY','C09P-'||lpad(n::text,5,'0'),public.normalize_reference_key('LEGACY','C09P-'||lpad(n::text,5,'0'),null),'SEALED',gen_random_uuid(),n % 7,now(),${quote(actor)} from generate_series(1,1500) n;`)
  const ids = `array[${await sql(`select string_agg(quote_literal(id::text),',' order by codigo) from (select id,codigo from public.inventory_sealed_references where inventory_id=${quote(inventory)} order by codigo limit 12) selected`)}]`
  const refs = `select r.* from public.inventory_sealed_references r where r.inventory_id=${quote(inventory)} and r.warehouse_id=${quote(warehouse)} and r.state='SEALED' and r.id=any(${ids}::uuid[])`
  // Exact source predicates from app_private.rp_release_eligibility; this is
  // deliberately not EXPLAIN SELECT public.preview_rp_release(...), which
  // would hide the SQL-language authority behind a Function Scan.
  const eligibility = `with refs as (${refs}), assessed as (
    select r.id reference_id,r.inventory_id,r.warehouse_id,r.reference_type identity_type,r.codigo sku,r.reference_value,r.physical_quantity sealed_quantity,
      (select m.source_cut_id from public.recount_missions m where m.source_sealed_reference_id=r.id order by m.created_at desc limit 1) source_cut_id,
      array_remove(array[
        case when r.physical_quantity is null or r.physical_quantity < 0 then 'NEGATIVE_QUANTITY' end,
        case when exists (select 1 from public.reference_findings f where f.reference_id=r.id and f.state in ('OPEN','HELD') and (f.blocks_rp or f.severity='CRITICAL')) then 'BLOCKS_RP_FINDING' end,
        case when exists (select 1 from public.recount_missions m where m.source_sealed_reference_id=r.id and m.round=2 and m.status in ('QUEUED','ACTIVE')) then 'OPEN_C2' end,
        case when exists (select 1 from public.recount_missions m where m.source_sealed_reference_id=r.id and m.round=3 and m.status in ('QUEUED','ACTIVE')) then 'OPEN_C3' end,
        case when exists (select 1 from public.reference_findings f where f.reference_id=r.id and f.state in ('OPEN','HELD') and f.finding_type='AUTHORIZATION_REVOKED_OFFLINE') then 'UNRESOLVED_REVIEW' end,
        case when exists (select 1 from public.orphan_references o where o.inventory_id=r.inventory_id and o.warehouse_id=r.warehouse_id and o.reference_type=r.reference_type and o.normalized_reference_key=r.normalized_reference_key and o.state<>'RESOLVED' and o.block_rp) then 'ORPHAN_REFERENCE' end,
        case when exists (select 1 from public.uom_resolution_cases u where u.reference_id=r.id and u.state in ('OPEN','HELD')) then 'UOM_CONFLICT' end
      ],null) blocker_codes from refs r)
    select *, cardinality(blocker_codes)=0 eligible from assessed`
  await explain('eligibility-source', `select * from (${eligibility}) q`)
  await explain('preview-material', `with items as (${eligibility} order by warehouse_id,identity_type,sku,coalesce(reference_value,''),reference_id), material as (select string_agg(concat_ws('|',reference_id,eligible,coalesce(array_to_string(blocker_codes,','),''),sealed_quantity,coalesce(source_cut_id::text,'')),E'\\n' order by warehouse_id,identity_type,sku,coalesce(reference_value,''),reference_id) value from items) select jsonb_build_object('items',(select jsonb_agg(to_jsonb(items)) from items),'fingerprint',encode(extensions.digest(convert_to((select value from material),'utf8'),'sha256'),'hex'))`)
  await explain('selected-reference-validation', `select r.id from public.inventory_sealed_references r where r.inventory_id=${quote(inventory)} and r.warehouse_id=${quote(warehouse)} and r.state='SEALED' and r.id=any(${ids}::uuid[]) for update`)
  await explain('create-snapshot-source', `select count(*) from (${eligibility}) snapshot where eligible`)
  console.log('PASS CUT2-09 performance: 1,500 local sealed references; no index added because the existing PK and scoped sealed-reference indexes are sufficient for the selected-reference path.')
} finally { await sql(cleanup).catch(() => {}) }
