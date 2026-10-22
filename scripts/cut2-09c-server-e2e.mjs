/** Local real-PostgreSQL certification for the CUT2-09C release workflow. */
import { spawnSync } from 'node:child_process'

const cases = [
  ['R01 preview eligible/fingerprint', 'supabase/tests/cut2_09_rp_release_core_test.sql'],
  ['R02 finding blocker', 'supabase/tests/cut2_09_rp_release_core_test.sql'],
  ['R03 unauthorized/scoped create', 'supabase/tests/cut2_09_rp_release_security_blockers_test.sql'],
  ['R04 DRAFT snapshot/audit', 'supabase/tests/cut2_09_rp_release_core_test.sql'],
  ['R05 PREVIEW_STALE', 'supabase/tests/cut2_09_rp_release_core_test.sql'],
  ['R06 warehouse scope', 'supabase/tests/cut2_09_rp_release_security_blockers_test.sql'],
  ['R07 READY/history/detail', 'supabase/tests/cut2_09_rp_release_manifest_export_test.sql'],
  ['R08 export/manifest/XLSX source', 'supabase/tests/cut2_09_rp_release_manifest_export_test.sql'],
  ['R09 no ERP mutation', 'supabase/tests/cut2_09_rp_release_identity_no_erp_test.sql'],
  ['R10 C2/C3 blockers', 'supabase/tests/cut2_09_rp_release_core_test.sql'],
]
const files = [...new Set(cases.map(([, file]) => file))]
const command = process.platform === 'win32' ? 'supabase.cmd' : 'supabase'
const result = spawnSync(command, ['test', 'db', '--local', ...files], { stdio: 'inherit' })
if (result.status !== 0) process.exit(result.status ?? 1)
for (const [id, source] of cases) console.log(`PASS ${id} (${source})`)
console.log('PASS CUT2-09C R01–R10: production RPCs exercised against local PostgreSQL without a backend mock.')
