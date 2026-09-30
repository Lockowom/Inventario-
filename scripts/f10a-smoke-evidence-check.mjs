import fs from 'node:fs'
import path from 'node:path'
import process from 'node:process'

const requiredFields = [
  'execution_id','gate','status','platform','candidate_sha','candidate_evidence_ref','candidate_evidence_sha256',
  'source_candidate_artifact_sha256','installed_artifact_sha256','install_method','signing_provenance',
  'version','build','environment','channel','production_locked','native_build_number',
  'app_display_version','device_model','os','os_version','started_at','finished_at',
  'operator','checks','evidence_refs','defects','notes',
]

const requiredChecks = [
  'app_launch',
  'release_identity_qa_beta',
  'supabase_configured',
  'authenticated_runtime',
  'health_non_blocking',
  'counting_screen',
  'my_counts_screen',
  'synthetic_count_saved',
  'synthetic_count_confirmed',
  'scanner_open_cancel_no_autosave',
]

function hasValue(value) {
  if (typeof value === 'string') return value.trim().length > 0
  return value !== null && value !== undefined
}

function fail(code, message) {
  console.error(`[FAIL] ${message}`)
  process.exit(code)
}

function validate(record) {
  const errors = []
  if (!record || typeof record !== 'object' || Array.isArray(record)) return ['INVALID_RECORD']

  for (const field of requiredFields) {
    if (!hasValue(record[field])) errors.push(`MISSING_${field.toUpperCase()}`)
  }

  if (record.gate !== 'F10A_BETA_SMOKE') errors.push('INVALID_GATE')
  if (!['NOT_RUN','PASS','FAIL','BLOCKED'].includes(record.status)) errors.push('INVALID_STATUS')
  if (!['android','ios'].includes(record.platform)) errors.push('INVALID_PLATFORM')
  const candidateEvidenceRef = String(record.candidate_evidence_ref ?? '')
  const normalizedCandidateEvidenceRef = path.posix.normalize(candidateEvidenceRef)
  if (!candidateEvidenceRef
    || candidateEvidenceRef.includes('\\')
    || path.posix.isAbsolute(candidateEvidenceRef)
    || normalizedCandidateEvidenceRef !== candidateEvidenceRef
    || normalizedCandidateEvidenceRef === '.'
    || normalizedCandidateEvidenceRef.startsWith('../')) {
    errors.push('INVALID_CANDIDATE_EVIDENCE_REF')
  }
  if (!/^[0-9a-f]{40}$/i.test(String(record.candidate_sha ?? ''))) errors.push('INVALID_CANDIDATE_SHA')
  if (!/^[0-9a-f]{64}$/i.test(String(record.candidate_evidence_sha256 ?? ''))) errors.push('INVALID_CANDIDATE_EVIDENCE_SHA256')
  if (!/^[0-9a-f]{64}$/i.test(String(record.source_candidate_artifact_sha256 ?? ''))) errors.push('INVALID_SOURCE_CANDIDATE_ARTIFACT_SHA256')
  if (!/^[0-9a-f]{64}$/i.test(String(record.installed_artifact_sha256 ?? ''))) errors.push('INVALID_INSTALLED_ARTIFACT_SHA256')
  if (!['local_device','managed_device_lab'].includes(record.install_method)) errors.push('INVALID_INSTALL_METHOD')
  if (!['candidate_as_built','ephemeral_lab_signing','laboratory_resign'].includes(record.signing_provenance)) {
    errors.push('INVALID_SIGNING_PROVENANCE')
  }
  if (record.platform === 'android' && record.signing_provenance === 'laboratory_resign') {
    errors.push('ANDROID_CANNOT_USE_LABORATORY_RESIGN')
  }
  if (record.platform === 'ios'
    && !['candidate_as_built','laboratory_resign'].includes(record.signing_provenance)) {
    errors.push('INVALID_IOS_SIGNING_PROVENANCE')
  }
  if (['candidate_as_built','ephemeral_lab_signing'].includes(record.signing_provenance)
    && record.source_candidate_artifact_sha256 !== record.installed_artifact_sha256) {
    errors.push('UNCHANGED_ARTIFACT_HASH_MISMATCH')
  }
  if (record.signing_provenance === 'laboratory_resign'
    && record.source_candidate_artifact_sha256 === record.installed_artifact_sha256) {
    errors.push('RESIGNED_ARTIFACT_HASH_UNCHANGED')
  }
  if (record.version !== '1.0.0') errors.push('INVALID_VERSION')
  const candidateSha = String(record.candidate_sha ?? '')
  const build = String(record.build ?? '')
  if (!/^[0-9a-f]{40}$/i.test(candidateSha)
    || !new RegExp(`^${candidateSha.slice(0, 8)}\\.\\d+import fs from 'node:fs'
import path from 'node:path'
import process from 'node:process'

const requiredFields = [
  'execution_id','gate','status','platform','candidate_sha','candidate_evidence_ref','candidate_evidence_sha256',
  'source_candidate_artifact_sha256','installed_artifact_sha256','install_method','signing_provenance',
  'version','build','environment','channel','production_locked','native_build_number',
  'app_display_version','device_model','os','os_version','started_at','finished_at',
  'operator','checks','evidence_refs','defects','notes',
]

const requiredChecks = [
  'app_launch',
  'release_identity_qa_beta',
  'supabase_configured',
  'authenticated_runtime',
  'health_non_blocking',
  'counting_screen',
  'my_counts_screen',
  'synthetic_count_saved',
  'synthetic_count_confirmed',
  'scanner_open_cancel_no_autosave',
]

function hasValue(value) {
  if (typeof value === 'string') return value.trim().length > 0
  return value !== null && value !== undefined
}

function fail(code, message) {
  console.error(`[FAIL] ${message}`)
  process.exit(code)
}

function validate(record) {
  const errors = []
  if (!record || typeof record !== 'object' || Array.isArray(record)) return ['INVALID_RECORD']

  for (const field of requiredFields) {
    if (!hasValue(record[field])) errors.push(`MISSING_${field.toUpperCase()}`)
  }

  if (record.gate !== 'F10A_BETA_SMOKE') errors.push('INVALID_GATE')
  if (!['NOT_RUN','PASS','FAIL','BLOCKED'].includes(record.status)) errors.push('INVALID_STATUS')
  if (!['android','ios'].includes(record.platform)) errors.push('INVALID_PLATFORM')
  const candidateEvidenceRef = String(record.candidate_evidence_ref ?? '')
  const normalizedCandidateEvidenceRef = path.posix.normalize(candidateEvidenceRef)
  if (!candidateEvidenceRef
    || candidateEvidenceRef.includes('\\')
    || path.posix.isAbsolute(candidateEvidenceRef)
    || normalizedCandidateEvidenceRef !== candidateEvidenceRef
    || normalizedCandidateEvidenceRef === '.'
    || normalizedCandidateEvidenceRef.startsWith('../')) {
    errors.push('INVALID_CANDIDATE_EVIDENCE_REF')
  }
  if (!/^[0-9a-f]{40}$/i.test(String(record.candidate_sha ?? ''))) errors.push('INVALID_CANDIDATE_SHA')
  if (!/^[0-9a-f]{64}$/i.test(String(record.candidate_evidence_sha256 ?? ''))) errors.push('INVALID_CANDIDATE_EVIDENCE_SHA256')
  if (!/^[0-9a-f]{64}$/i.test(String(record.source_candidate_artifact_sha256 ?? ''))) errors.push('INVALID_SOURCE_CANDIDATE_ARTIFACT_SHA256')
  if (!/^[0-9a-f]{64}$/i.test(String(record.installed_artifact_sha256 ?? ''))) errors.push('INVALID_INSTALLED_ARTIFACT_SHA256')
  if (!['local_device','managed_device_lab'].includes(record.install_method)) errors.push('INVALID_INSTALL_METHOD')
  if (!['candidate_as_built','ephemeral_lab_signing','laboratory_resign'].includes(record.signing_provenance)) {
    errors.push('INVALID_SIGNING_PROVENANCE')
  }
  if (record.platform === 'android' && record.signing_provenance === 'laboratory_resign') {
    errors.push('ANDROID_CANNOT_USE_LABORATORY_RESIGN')
  }
  if (record.platform === 'ios'
    && !['candidate_as_built','laboratory_resign'].includes(record.signing_provenance)) {
    errors.push('INVALID_IOS_SIGNING_PROVENANCE')
  }
  if (['candidate_as_built','ephemeral_lab_signing'].includes(record.signing_provenance)
    && record.source_candidate_artifact_sha256 !== record.installed_artifact_sha256) {
    errors.push('UNCHANGED_ARTIFACT_HASH_MISMATCH')
  }
  if (record.signing_provenance === 'laboratory_resign'
    && record.source_candidate_artifact_sha256 === record.installed_artifact_sha256) {
    errors.push('RESIGNED_ARTIFACT_HASH_UNCHANGED')
  }
, 'i').test(build)) {
    errors.push('INVALID_BUILD')
  }
  const expectedDisplayVersion = `${record.version}-${record.channel}+${build}`
  if (record.app_display_version !== expectedDisplayVersion) errors.push('INVALID_APP_DISPLAY_VERSION')
  if (record.environment !== 'qa') errors.push('INVALID_ENVIRONMENT')
  if (record.channel !== 'beta') errors.push('INVALID_CHANNEL')
  if (record.production_locked !== true) errors.push('PRODUCTION_NOT_LOCKED')
  if (!Number.isInteger(record.native_build_number) || record.native_build_number <= 0) errors.push('INVALID_NATIVE_BUILD_NUMBER')
  if (!Array.isArray(record.evidence_refs)) errors.push('INVALID_EVIDENCE_REFS')
  if (!Array.isArray(record.defects)) errors.push('INVALID_DEFECTS')

  if (!record.checks || typeof record.checks !== 'object' || Array.isArray(record.checks)) {
    errors.push('INVALID_CHECKS')
  } else {
    for (const check of requiredChecks) {
      if (typeof record.checks[check] !== 'boolean') errors.push(`INVALID_CHECK_${check.toUpperCase()}`)
      if (record.status === 'PASS' && record.checks[check] !== true) errors.push(`PASS_REQUIRES_${check.toUpperCase()}`)
    }
  }

  if (record.status === 'PASS' && record.evidence_refs.length === 0) errors.push('PASS_REQUIRES_EVIDENCE')

  for (const value of ['started_at','finished_at']) {
    const parsed = Date.parse(String(record[value] ?? ''))
    if (!Number.isFinite(parsed)) errors.push(`INVALID_${value.toUpperCase()}`)
  }

  if (Number.isFinite(Date.parse(record.started_at)) && Number.isFinite(Date.parse(record.finished_at))) {
    if (Date.parse(record.finished_at) < Date.parse(record.started_at)) errors.push('FINISHED_BEFORE_STARTED')
  }

  if (Array.isArray(record.defects)) {
    for (const defect of record.defects) {
      if (!defect || typeof defect !== 'object' || Array.isArray(defect)) {
        errors.push('INVALID_DEFECT')
        continue
      }
      for (const field of ['defect_id','severity','scenario','description','expected','observed','status','evidence']) {
        if (!hasValue(defect[field])) errors.push(`MISSING_DEFECT_${field.toUpperCase()}`)
      }
      const severity = String(defect.severity ?? '').toUpperCase()
      if (!['BLOCKER','CRITICAL','MAJOR','MINOR'].includes(severity)) errors.push('INVALID_DEFECT_SEVERITY')
      if (record.status === 'PASS' && ['BLOCKER','CRITICAL'].includes(severity) && String(defect.status).toUpperCase() === 'OPEN') {
        errors.push('PASS_HAS_OPEN_BLOCKING_DEFECT')
      }
    }
  }

  return errors
}

const file = process.argv[2]
if (!file) fail(80, 'usage: node scripts/f10a-smoke-evidence-check.mjs <evidence.json>')
const full = path.resolve(process.cwd(), file)
if (!fs.existsSync(full)) fail(81, `evidence file not found: ${file}`)

let record
try {
  record = JSON.parse(fs.readFileSync(full, 'utf8'))
} catch {
  fail(82, 'evidence file is not valid JSON')
}

const errors = validate(record)
if (errors.length) {
  console.error('[FAIL] F10A_BETA_SMOKE_EVIDENCE')
  for (const error of errors) console.error(`[FAIL] ${error}`)
  process.exit(83)
}

console.log(`[PASS] F10A_BETA_SMOKE_EVIDENCE platform=${record.platform} status=${record.status}`)
if (record.status === 'PASS') console.log('[PASS] READY_FOR_F10A_CLOSURE')
