/**
 * CUT2-11B remote-QA proof for final-close serialization.
 *
 * Bootstrap and cleanup use the QA service boundary for synthetic-only rows.
 * The racing operations themselves are authenticated PostgREST RPC calls using
 * the QA analyst's short-lived JWT.  No credential is printed or persisted.
 */
import { execFileSync } from 'node:child_process'
import { randomUUID } from 'node:crypto'

const ref = process.env.SUPABASE_QA_REF ?? 'kpsdephjbvkwvazxubtb'
const url = `https://${ref}.supabase.co`
const analystId = '321eeec7-1292-401f-97aa-7264775663d4'
const warehouseId = '00000000-0000-0000-0000-00000000c202'

function qaKeys() {
  const raw = execFileSync('cmd.exe', ['/d', '/s', '/c', `%APPDATA%\\npm\\supabase.cmd projects api-keys --project-ref ${ref} --reveal --output json`], { encoding: 'utf8', windowsHide: true })
  const keys = JSON.parse(raw)
  const value = (names) => {
    const item = keys.find((key) => names.includes(String(key.name ?? key.key_name ?? '').toLowerCase()))
    return item?.api_key ?? item?.key ?? item?.value
  }
  const anon = value(['anon', 'publishable'])
  const service = value(['service_role', 'secret'])
  if (!anon || !service) throw new Error('QA_API_KEYS_UNAVAILABLE')
  return { anon, service }
}

const assert = (condition, message) => { if (!condition) throw new Error(message) }
const jsonHeaders = (key, token = key) => ({ apikey: key, Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' })

async function request(path, options, key, token = key) {
  const response = await fetch(`${url}${path}`, { ...options, headers: { ...jsonHeaders(key, token), ...(options.headers ?? {}) } })
  const text = await response.text()
  let body = null
  try { body = text ? JSON.parse(text) : null } catch { body = text }
  return { status: response.status, body }
}

async function expectOk(path, options, key, token = key, label = path) {
  const result = await request(path, options, key, token)
  if (result.status < 200 || result.status >= 300) throw new Error(`${label}:HTTP_${result.status}:${typeof result.body === 'object' ? result.body?.message ?? result.body?.code ?? 'unknown' : 'unknown'}`)
  return result.body
}

async function actorSession(keys) {
  const users = await expectOk('/auth/v1/admin/users?per_page=1000', { method: 'GET' }, keys.service, keys.service, 'USERS')
  const email = users.users?.find((user) => user.id === analystId)?.email
  if (!email) throw new Error('QA_ANALYST_NOT_FOUND')
  const password = `Qa11b-race-${randomUUID()}-A9!`
  await expectOk(`/auth/v1/admin/users/${analystId}`, { method: 'PUT', body: JSON.stringify({ password, email_confirm: true }) }, keys.service, keys.service, 'PASSWORD_ROTATE')
  const signedIn = await expectOk('/auth/v1/token?grant_type=password', { method: 'POST', body: JSON.stringify({ email, password }) }, keys.anon, keys.anon, 'ANALYST_LOGIN')
  assert(typeof signedIn.access_token === 'string', 'ANALYST_JWT_MISSING')
  return signedIn.access_token
}

async function insert(table, row, keys) {
  return expectOk(`/rest/v1/${table}`, { method: 'POST', headers: { Prefer: 'return=minimal' }, body: JSON.stringify(row) }, keys.service, keys.service, `BOOTSTRAP_${table}`)
}

async function rows(table, filter, keys) {
  return expectOk(`/rest/v1/${table}?${filter}`, { method: 'GET' }, keys.service, keys.service, `READ_${table}`)
}

async function remove(table, filter, keys) {
  await expectOk(`/rest/v1/${table}?${filter}`, { method: 'DELETE', headers: { Prefer: 'return=minimal' } }, keys.service, keys.service, `CLEANUP_${table}`)
}

async function bootstrap(label, keys) {
  const inventoryId = randomUUID()
  const code = `C11B-${label}-${inventoryId.slice(0, 8)}`.toUpperCase()
  const now = new Date().toISOString()
  await insert('inventories', {
    id: inventoryId, name: `CUT2-11B ${label} ${inventoryId.slice(0, 8)}`, status: 'ABIERTO', warehouse_id: warehouseId,
    created_by: analystId, prepared_at: now, prepared_by: analystId, opened_at: now, opened_by: analystId,
    c1_completed_at: now, c1_completed_by: analystId, c1_count_records: 0, c1_counted_units: 0,
    c1_master_fingerprint: `c11b-master-${inventoryId}`, c1_reference_fingerprint: `c11b-reference-${inventoryId}`,
  }, keys)
  await insert('inventory_assignments', { inventory_id: inventoryId, user_id: analystId, assigned_by: analystId }, keys)
  await insert('inventory_master_items', { inventory_id: inventoryId, codigo: code, descripcion: `CUT2-11B ${label}`, control_type: 'LEGACY', source: 'CUT2-11B', created_by: analystId }, keys)
  await insert('inventory_system_reference_items', { inventory_id: inventoryId, codigo: code, reference_type: 'LEGACY', quantity: 1, source_total_quantity: 1, source_available_quantity: 1, unit_code: 'UN' }, keys)
  return { inventoryId, code }
}

async function cleanup(inventoryId, keys) {
  try {
    const findings = await rows('reference_findings', `select=id&inventory_id=eq.${inventoryId}`, keys)
    const ids = findings.map((finding) => finding.id)
    if (ids.length) {
      const inList = `in.(${ids.join(',')})`
      await remove('finding_evidence', `finding_id=${inList}`, keys).catch(() => {})
      await remove('reference_finding_events', `finding_id=${inList}`, keys).catch(() => {})
      await remove('reference_findings', `id=${inList}`, keys).catch(() => {})
    }
    await remove('preseal_guard_events', `inventory_id=eq.${inventoryId}`, keys).catch(() => {})
    await remove('audit_events', `inventory_id=eq.${inventoryId}`, keys).catch(() => {})
    await remove('inventory_close_requests', `inventory_id=eq.${inventoryId}`, keys).catch(() => {})
    await remove('recount_missions', `inventory_id=eq.${inventoryId}`, keys).catch(() => {})
    await remove('reconciliation_cases', `inventory_id=eq.${inventoryId}`, keys).catch(() => {})
    await remove('rp_release_events', `inventory_id=eq.${inventoryId}`, keys).catch(() => {})
    await remove('rp_release_audits', `inventory_id=eq.${inventoryId}`, keys).catch(() => {})
    await remove('rp_release_batches', `inventory_id=eq.${inventoryId}`, keys).catch(() => {})
    await remove('inventory_sealed_references', `inventory_id=eq.${inventoryId}`, keys).catch(() => {})
    await remove('inventory_system_reference_items', `inventory_id=eq.${inventoryId}`, keys).catch(() => {})
    await remove('inventory_master_items', `inventory_id=eq.${inventoryId}`, keys).catch(() => {})
    await remove('inventory_assignments', `inventory_id=eq.${inventoryId}`, keys).catch(() => {})
    await remove('inventories', `id=eq.${inventoryId}`, keys).catch(() => {})
  } catch { /* Cleanup must not obscure a behavioral result. */ }
}

async function rpc(name, payload, keys, token) {
  return request(`/rest/v1/rpc/${name}`, { method: 'POST', body: JSON.stringify(payload) }, keys.anon, token)
}

async function preview(inventoryId, keys, token) {
  const result = await rpc('preview_inventory_close', { p_inventory_id: inventoryId }, keys, token)
  assert(result.status === 200 && result.body?.is_ready === true && typeof result.body?.fingerprint === 'string', `READY_PREVIEW_FAILED:${result.status}:${result.body?.message ?? ''}`)
  return result.body
}

async function scalarCount(table, filter, keys) {
  const response = await fetch(`${url}/rest/v1/${table}?${filter}`, { method: 'HEAD', headers: { ...jsonHeaders(keys.service), Prefer: 'count=exact' } })
  const count = response.headers.get('content-range')?.split('/')[1]
  if (!response.ok || count === null) throw new Error(`COUNT_${table}_FAILED:${response.status}`)
  return Number(count)
}

async function closeClose(keys, token) {
  const fixture = await bootstrap('C01', keys)
  try {
    const state = await preview(fixture.inventoryId, keys, token)
    const results = await Promise.all([
      rpc('close_inventory_final', { p_inventory_id: fixture.inventoryId, p_expected_fingerprint: state.fingerprint, p_request_id: randomUUID() }, keys, token),
      rpc('close_inventory_final', { p_inventory_id: fixture.inventoryId, p_expected_fingerprint: state.fingerprint, p_request_id: randomUUID() }, keys, token),
    ])
    const codes = results.map((result) => result.status)
    assert(codes.filter((code) => code === 200).length === 1, `C01_WINNERS:${codes.join(',')}`)
    assert(codes.some((code) => code === 400), `C01_LOSER_NOT_REJECTED:${codes.join(',')}`)
    assert(await scalarCount('inventory_close_requests', `inventory_id=eq.${fixture.inventoryId}&state=eq.COMPLETED`, keys) === 1, 'C01_COMPLETED_REQUESTS')
    assert(await scalarCount('audit_events', `inventory_id=eq.${fixture.inventoryId}&event_type=eq.INVENTORY_CLOSED`, keys) === 1, 'C01_CLOSE_AUDIT')
    return { inventoryId: fixture.inventoryId, statuses: codes }
  } finally { await cleanup(fixture.inventoryId, keys) }
}

async function closeFinding(keys, token, attempt) {
  const fixture = await bootstrap(`C02-${attempt}`, keys)
  try {
    const state = await preview(fixture.inventoryId, keys, token)
    const [close, finding] = await Promise.all([
      rpc('close_inventory_final', { p_inventory_id: fixture.inventoryId, p_expected_fingerprint: state.fingerprint, p_request_id: randomUUID() }, keys, token),
      rpc('create_preseal_reference_finding', { p_inventory_id: fixture.inventoryId, p_reference_type: 'LEGACY', p_normalized_reference_key: fixture.code, p_finding_type: 'OTHER', p_description: `CUT2-11B concurrent blocker ${attempt}`, p_critical: true }, keys, token),
    ])
    const inventory = (await rows('inventories', `select=status&id=eq.${fixture.inventoryId}`, keys))[0]
    const openFindings = await scalarCount('reference_findings', `inventory_id=eq.${fixture.inventoryId}&state=eq.OPEN`, keys)
    const coherent = (inventory.status === 'CERRADO' && close.status === 200 && finding.status === 400 && openFindings === 0)
      || (inventory.status === 'ABIERTO' && finding.status === 200 && close.status === 400 && openFindings === 1)
    assert(coherent, `C02_INCOHERENT:close=${close.status},finding=${finding.status},status=${inventory.status},open=${openFindings}`)
    return { inventoryId: fixture.inventoryId, close: close.status, finding: finding.status, final: inventory.status }
  } finally { await cleanup(fixture.inventoryId, keys) }
}

async function closeC2(keys, token) {
  const fixture = await bootstrap('C03', keys)
  const caseId = randomUUID(); const missionId = randomUUID()
  try {
    const state = await preview(fixture.inventoryId, keys, token)
    const activate = async () => {
      const caseResult = await request('/rest/v1/reconciliation_cases', { method: 'POST', headers: { Prefer: 'return=minimal' }, body: JSON.stringify({ id: caseId, inventory_id: fixture.inventoryId, codigo: fixture.code, reference_type: 'LEGACY', anomaly_type: 'CUT2_11B_C2_RACE', system_quantity: 1, physical_quantity: 2, status: 'REQUIERE_2DO_CONTEO', created_by: analystId }) }, keys.service, keys.service)
      if (caseResult.status >= 300) return { caseStatus: caseResult.status, missionStatus: null }
      const missionResult = await request('/rest/v1/recount_missions', { method: 'POST', headers: { Prefer: 'return=minimal' }, body: JSON.stringify({ id: missionId, case_id: caseId, inventory_id: fixture.inventoryId, round: 2, status: 'QUEUED', created_by: analystId }) }, keys.service, keys.service)
      return { caseStatus: caseResult.status, missionStatus: missionResult.status }
    }
    const [close, c2] = await Promise.all([
      rpc('close_inventory_final', { p_inventory_id: fixture.inventoryId, p_expected_fingerprint: state.fingerprint, p_request_id: randomUUID() }, keys, token),
      activate(),
    ])
    const inventory = (await rows('inventories', `select=status&id=eq.${fixture.inventoryId}`, keys))[0]
    const queued = await scalarCount('recount_missions', `inventory_id=eq.${fixture.inventoryId}&round=eq.2&status=eq.QUEUED`, keys)
    const coherent = (inventory.status === 'CERRADO' && close.status === 200 && queued === 0)
      || (inventory.status === 'ABIERTO' && close.status === 400 && queued === 1)
    assert(coherent, `C03_INCOHERENT:close=${close.status},case=${c2.caseStatus},mission=${c2.missionStatus},status=${inventory.status},queued=${queued}`)
    return { inventoryId: fixture.inventoryId, close: close.status, ...c2, final: inventory.status }
  } finally { await cleanup(fixture.inventoryId, keys) }
}

async function closeC3(keys, token) {
  const fixture = await bootstrap('C04', keys)
  const caseId = randomUUID(); const c2Id = randomUUID(); const c3Id = randomUUID()
  try {
    const state = await preview(fixture.inventoryId, keys, token)
    const activate = async () => {
      const caseResult = await request('/rest/v1/reconciliation_cases', { method: 'POST', headers: { Prefer: 'return=minimal' }, body: JSON.stringify({ id: caseId, inventory_id: fixture.inventoryId, codigo: fixture.code, reference_type: 'LEGACY', anomaly_type: 'CUT2_11B_C3_RACE', system_quantity: 1, physical_quantity: 3, status: 'REQUIERE_3ER_CONTEO', created_by: analystId }) }, keys.service, keys.service)
      if (caseResult.status >= 300) return { caseStatus: caseResult.status, c2Status: null, c3Status: null }
      const c2Result = await request('/rest/v1/recount_missions', { method: 'POST', headers: { Prefer: 'return=minimal' }, body: JSON.stringify({ id: c2Id, case_id: caseId, inventory_id: fixture.inventoryId, round: 2, status: 'COMPLETED', assigned_user_id: analystId, claimed_at: new Date().toISOString(), completed_at: new Date().toISOString(), total_quantity: 2, created_by: analystId }) }, keys.service, keys.service)
      if (c2Result.status >= 300) return { caseStatus: caseResult.status, c2Status: c2Result.status, c3Status: null }
      const c3Result = await request('/rest/v1/recount_missions', { method: 'POST', headers: { Prefer: 'return=minimal' }, body: JSON.stringify({ id: c3Id, case_id: caseId, inventory_id: fixture.inventoryId, round: 3, status: 'QUEUED', created_by: analystId }) }, keys.service, keys.service)
      return { caseStatus: caseResult.status, c2Status: c2Result.status, c3Status: c3Result.status }
    }
    const [close, c3] = await Promise.all([
      rpc('close_inventory_final', { p_inventory_id: fixture.inventoryId, p_expected_fingerprint: state.fingerprint, p_request_id: randomUUID() }, keys, token),
      activate(),
    ])
    const inventory = (await rows('inventories', `select=status&id=eq.${fixture.inventoryId}`, keys))[0]
    const queued = await scalarCount('recount_missions', `inventory_id=eq.${fixture.inventoryId}&round=eq.3&status=eq.QUEUED`, keys)
    const coherent = (inventory.status === 'CERRADO' && close.status === 200 && queued === 0)
      || (inventory.status === 'ABIERTO' && close.status === 400 && queued === 1)
    assert(coherent, `C04_INCOHERENT:close=${close.status},case=${c3.caseStatus},c2=${c3.c2Status},c3=${c3.c3Status},status=${inventory.status},queued=${queued}`)
    return { inventoryId: fixture.inventoryId, close: close.status, ...c3, final: inventory.status }
  } finally { await cleanup(fixture.inventoryId, keys) }
}

async function closeRp(keys, token) {
  const fixture = await bootstrap('C05', keys)
  const referenceId = randomUUID()
  try {
    await insert('inventory_sealed_references', { id: referenceId, inventory_id: fixture.inventoryId, warehouse_id: warehouseId, reference_type: 'LEGACY', codigo: fixture.code, normalized_reference_key: fixture.code, state: 'SEALED', request_id: randomUUID(), physical_quantity: 1, sealed_at: new Date().toISOString(), sealed_by: analystId }, keys)
    const releasePreview = await rpc('preview_rp_release', { p_inventory_id: fixture.inventoryId, p_warehouse_id: warehouseId, p_reference_ids: [referenceId] }, keys, token)
    assert(releasePreview.status === 200, `C05_RP_PREVIEW:${releasePreview.status}`)
    const created = await rpc('create_rp_release', { p_inventory_id: fixture.inventoryId, p_warehouse_id: warehouseId, p_reference_ids: [referenceId], p_expected_fingerprint: releasePreview.body.fingerprint, p_request_id: randomUUID() }, keys, token)
    assert(created.status === 200 && created.body?.release_id, `C05_RP_CREATE:${created.status}`)
    const staleClosePreview = await rpc('preview_inventory_close', { p_inventory_id: fixture.inventoryId }, keys, token)
    assert(staleClosePreview.status === 200 && staleClosePreview.body?.is_ready === false, 'C05_DRAFT_NOT_BLOCKING_CLOSE')
    const [close, ready] = await Promise.all([
      rpc('close_inventory_final', { p_inventory_id: fixture.inventoryId, p_expected_fingerprint: staleClosePreview.body.fingerprint, p_request_id: randomUUID() }, keys, token),
      rpc('mark_rp_release_ready', { p_release_id: created.body.release_id, p_request_id: randomUUID() }, keys, token),
    ])
    assert(ready.status === 200 && ready.body?.state === 'READY', `C05_RP_READY:${ready.status}`)
    assert(close.status === 400, `C05_STALE_CLOSE_ACCEPTED:${close.status}`)
    const fresh = await preview(fixture.inventoryId, keys, token)
    const finalClose = await rpc('close_inventory_final', { p_inventory_id: fixture.inventoryId, p_expected_fingerprint: fresh.fingerprint, p_request_id: randomUUID() }, keys, token)
    assert(finalClose.status === 200, `C05_FRESH_CLOSE:${finalClose.status}`)
    return { inventoryId: fixture.inventoryId, close: close.status, ready: ready.status, finalClose: finalClose.status }
  } finally { await cleanup(fixture.inventoryId, keys) }
}

const keys = qaKeys()
const token = await actorSession(keys)
const stage = process.env.C11B_STAGE ?? 'all'
const report = { remoteQa: ref, invariant: 'NO_CLOSED_WITH_OPEN_FINDING_OR_MISSION', credentialsPersisted: false }
if (stage === 'c01' || stage === 'all') report.C01 = await closeClose(keys, token)
if (stage === 'c02' || stage === 'all') {
  report.C02 = []
  for (let attempt = 1; attempt <= 3; attempt += 1) report.C02.push(await closeFinding(keys, token, attempt))
}
if (stage === 'c03' || stage === 'all') report.C03 = await closeC2(keys, token)
if (stage === 'c04' || stage === 'all') report.C04 = await closeC3(keys, token)
if (stage === 'c05' || stage === 'all') report.C05 = await closeRp(keys, token)
if (!['all', 'c01', 'c02', 'c03', 'c04', 'c05'].includes(stage)) throw new Error('UNKNOWN_C11B_STAGE')
console.log(JSON.stringify(report))
