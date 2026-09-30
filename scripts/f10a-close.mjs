import crypto from 'node:crypto'
import fs from 'node:fs'
import path from 'node:path'
import process from 'node:process'
import { execFileSync } from 'node:child_process'
import { fileURLToPath } from 'node:url'

function fail(code, message) {
  console.error(`[FAIL] ${message}`)
  process.exit(code)
}

function parseArgs(argv) {
  const out = {
    androidCandidate: '',
    iosCandidate: '',
    parity: '',
    androidSmoke: '',
    iosSmoke: '',
    output: 'artifacts/release/INVEN3-F10A-closure.json',
  }
  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i]
    if (arg === '--android-candidate') out.androidCandidate = argv[++i] || ''
    else if (arg === '--ios-candidate') out.iosCandidate = argv[++i] || ''
    else if (arg === '--parity') out.parity = argv[++i] || ''
    else if (arg === '--android-smoke') out.androidSmoke = argv[++i] || ''
    else if (arg === '--ios-smoke') out.iosSmoke = argv[++i] || ''
    else if (arg === '--out') out.output = argv[++i] || ''
    else fail(90, `unknown argument: ${arg}`)
  }
  return out
}

function read(root, value, label) {
  if (!value) fail(91, `missing argument for ${label}`)
  const full = path.resolve(root, value)
  if (!fs.existsSync(full)) fail(92, `${label} not found: ${value}`)
  try {
    return JSON.parse(fs.readFileSync(full, 'utf8'))
  } catch {
    fail(93, `${label} is not valid JSON`)
  }
}

function fileSha256(root, value) {
  const full = path.resolve(root, value)
  return crypto.createHash('sha256').update(fs.readFileSync(full)).digest('hex')
}

function validateSmokeEvidence(root, evidencePath, label) {
  const checker = path.join(path.dirname(fileURLToPath(import.meta.url)), 'f10a-smoke-evidence-check.mjs')
  try {
    execFileSync(process.execPath, [checker, path.resolve(root, evidencePath)], {
      cwd: root,
      encoding: 'utf8',
      stdio: ['ignore', 'pipe', 'pipe'],
    })
  } catch (error) {
    const stderr = String(error?.stderr ?? '').trim()
    fail(115, `${label} failed full schema validation${stderr ? `: ${stderr.replaceAll('\n', ' | ')}` : ''}`)
  }
}

function hasOpenBlockingDefect(defects) {
  return Array.isArray(defects) && defects.some((defect) =>
    ['BLOCKER','CRITICAL'].includes(String(defect?.severity ?? '').toUpperCase())
    && String(defect?.status ?? '').toUpperCase() === 'OPEN'
  )
}

function isSha256(value) {
  return /^[0-9a-f]{64}$/i.test(String(value ?? ''))
}

function validArtifacts(artifacts) {
  return Array.isArray(artifacts) && artifacts.length > 0 && artifacts.every((artifact) =>
    artifact
    && typeof artifact.path === 'string'
    && artifact.path.trim().length > 0
    && Number.isInteger(artifact.bytes)
    && artifact.bytes > 0
    && isSha256(artifact.sha256)
  )
}

function normalizedArtifacts(artifacts) {
  return [...artifacts]
    .map(({ path: artifactPath, bytes, sha256 }) => ({ path: artifactPath, bytes, sha256 }))
    .sort((a, b) => a.path.localeCompare(b.path))
}

function validNativeWebVerification(candidate, platform) {
  const evidence = candidate?.nativeWebVerification
  return evidence
    && evidence.gate === 'F10A_NATIVE_WEB_PARITY'
    && evidence.status === 'PASS'
    && evidence.platform === platform
    && Number.isInteger(evidence.verifiedFileCount)
    && evidence.verifiedFileCount > 0
    && Number.isInteger(evidence.nativeFileCount)
    && evidence.nativeFileCount === evidence.verifiedFileCount
    && evidence.webBundleSha256 === candidate.webBundleSha256
    && typeof evidence.evidencePath === 'string'
    && evidence.evidencePath.trim().length > 0
    && isSha256(evidence.evidenceSha256)
}

function normalizedNativeWebVerification(evidence) {
  return {
    gate: evidence.gate,
    status: evidence.status,
    platform: evidence.platform,
    verifiedFileCount: evidence.verifiedFileCount,
    nativeFileCount: evidence.nativeFileCount,
    webBundleSha256: evidence.webBundleSha256,
    evidencePath: evidence.evidencePath,
    evidenceSha256: evidence.evidenceSha256,
  }
}

function findArtifactByHash(candidate, value) {
  const expected = String(value ?? '').toLowerCase()
  return candidate.artifacts.find((artifact) => String(artifact.sha256).toLowerCase() === expected)
}

function isInstallableSource(platform, artifact) {
  const artifactPath = String(artifact?.path ?? '').toLowerCase()
  return platform === 'android' ? artifactPath.endsWith('.apk') : artifactPath.endsWith('.ipa')
}

const args = parseArgs(process.argv.slice(2))
const root = process.cwd()
const policy = JSON.parse(fs.readFileSync(path.join(root, 'release-policy.json'), 'utf8'))
if (policy.productionLocked !== true) fail(94, 'F10A closure requires productionLocked=true')

const androidCandidate = read(root, args.androidCandidate, 'android candidate evidence')
const iosCandidate = read(root, args.iosCandidate, 'ios candidate evidence')
const parity = read(root, args.parity, 'platform parity evidence')
const androidSmoke = read(root, args.androidSmoke, 'android smoke evidence')
const iosSmoke = read(root, args.iosSmoke, 'ios smoke evidence')
const androidCandidateEvidenceSha256 = fileSha256(root, args.androidCandidate)
const iosCandidateEvidenceSha256 = fileSha256(root, args.iosCandidate)
const parityEvidenceSha256 = fileSha256(root, args.parity)

validateSmokeEvidence(root, args.androidSmoke, 'android smoke')
validateSmokeEvidence(root, args.iosSmoke, 'ios smoke')

for (const [label, candidate, platform] of [
  ['android candidate', androidCandidate, 'android'],
  ['ios candidate', iosCandidate, 'ios'],
]) {
  if (candidate.gate !== 'F10A_RELEASE_CANDIDATE') fail(95, `${label} gate invalid`)
  if (candidate.status !== 'READY_FOR_BETA_SMOKE') fail(96, `${label} is not READY_FOR_BETA_SMOKE`)
  if (candidate.platform !== platform) fail(97, `${label} platform mismatch`)
  if (candidate.environment !== 'qa' || candidate.channel !== 'beta') fail(98, `${label} is not QA/BETA`)
  if (candidate.productionLocked !== true) fail(99, `${label} production lock missing`)
  if (candidate.product !== policy.product) fail(116, `${label} product mismatch`)
  if (candidate.version !== policy.releaseVersion) fail(116, `${label} version mismatch with policy`)
  if (!candidate.build || typeof candidate.build !== 'string') fail(116, `${label} build identity missing`)
  if (!/^[0-9a-f]{40}$/i.test(String(candidate.commit ?? ''))) fail(116, `${label} commit invalid`)
  if (!isSha256(candidate.webBundleSha256)) fail(116, `${label} web bundle hash invalid`)
  if (!Number.isInteger(candidate.nativeBuildNumber) || candidate.nativeBuildNumber <= 0) fail(116, `${label} native build invalid`)
  if (!validArtifacts(candidate.artifacts)) fail(116, `${label} artifact evidence invalid`)
  if (!validNativeWebVerification(candidate, platform)) fail(116, `${label} native web parity evidence invalid`)
}

if (parity.gate !== 'F10A_PLATFORM_PARITY' || parity.status !== 'READY_FOR_BETA_SMOKE') {
  fail(100, 'platform parity is not READY_FOR_BETA_SMOKE')
}
if (parity.productionLocked !== true) fail(101, 'platform parity lost production lock')
if (parity.product !== policy.product || parity.version !== policy.releaseVersion) {
  fail(117, 'platform parity product/version mismatch')
}
if (!/^[0-9a-f]{40}$/i.test(String(parity.commit ?? '')) || !isSha256(parity.webBundleSha256)) {
  fail(117, 'platform parity commit/hash invalid')
}
if (!parity.platforms || typeof parity.platforms !== 'object') fail(117, 'platform parity platform details missing')

for (const [label, smoke, platform] of [
  ['android smoke', androidSmoke, 'android'],
  ['ios smoke', iosSmoke, 'ios'],
]) {
  if (smoke.gate !== 'F10A_BETA_SMOKE') fail(102, `${label} gate invalid`)
  if (smoke.status !== 'PASS') fail(103, `${label} is not PASS`)
  if (smoke.platform !== platform) fail(104, `${label} platform mismatch`)
  if (smoke.environment !== 'qa' || smoke.channel !== 'beta') fail(105, `${label} is not QA/BETA`)
  if (smoke.production_locked !== true) fail(106, `${label} production lock missing`)
  if (hasOpenBlockingDefect(smoke.defects)) fail(107, `${label} has open BLOCKER/CRITICAL defect`)
}

const fields = ['version','environment','channel','build','commit','webBundleSha256']
for (const field of fields) {
  if (androidCandidate[field] !== iosCandidate[field]) fail(108, `candidate mismatch: ${field}`)
  if (parity[field] !== androidCandidate[field]) fail(109, `parity mismatch: ${field}`)
}
if (androidCandidate.nativeBuildNumber !== iosCandidate.nativeBuildNumber) {
  fail(108, 'candidate mismatch: nativeBuildNumber')
}
if (parity.nativeBuildNumber !== androidCandidate.nativeBuildNumber) {
  fail(109, 'parity mismatch: nativeBuildNumber')
}

for (const [platform, candidate] of [['android', androidCandidate], ['ios', iosCandidate]]) {
  const parityPlatform = parity.platforms?.[platform]
  if (!parityPlatform || parityPlatform.build !== candidate.build) fail(117, `parity ${platform} build mismatch`)
  if (parityPlatform.nativeBuildNumber !== candidate.nativeBuildNumber) fail(117, `parity ${platform} native build mismatch`)
  if (!validArtifacts(parityPlatform.artifacts)) fail(117, `parity ${platform} artifacts invalid`)
  if (!validNativeWebVerification({ ...candidate, nativeWebVerification: parityPlatform.nativeWebVerification }, platform)) {
    fail(117, `parity ${platform} native web evidence invalid`)
  }
  if (JSON.stringify(normalizedNativeWebVerification(parityPlatform.nativeWebVerification))
    !== JSON.stringify(normalizedNativeWebVerification(candidate.nativeWebVerification))) {
    fail(117, `parity ${platform} native web evidence mismatch`)
  }
  if (JSON.stringify(normalizedArtifacts(parityPlatform.artifacts)) !== JSON.stringify(normalizedArtifacts(candidate.artifacts))) {
    fail(117, `parity ${platform} artifact evidence mismatch`)
  }
}

if (androidSmoke.candidate_sha !== androidCandidate.commit) fail(110, 'android smoke candidate SHA mismatch')
if (iosSmoke.candidate_sha !== iosCandidate.commit) fail(111, 'ios smoke candidate SHA mismatch')
if (androidSmoke.candidate_evidence_sha256 !== androidCandidateEvidenceSha256) fail(120, 'android smoke candidate evidence SHA-256 mismatch')
if (iosSmoke.candidate_evidence_sha256 !== iosCandidateEvidenceSha256) fail(121, 'ios smoke candidate evidence SHA-256 mismatch')
if (androidSmoke.version !== androidCandidate.version || iosSmoke.version !== iosCandidate.version) fail(112, 'smoke version mismatch')
if (androidSmoke.native_build_number !== androidCandidate.nativeBuildNumber) fail(113, 'android smoke native build mismatch')
if (iosSmoke.native_build_number !== iosCandidate.nativeBuildNumber) fail(114, 'ios smoke native build mismatch')

const androidSourceArtifact = findArtifactByHash(androidCandidate, androidSmoke.source_candidate_artifact_sha256)
if (!androidSourceArtifact) {
  fail(118, 'android smoke source artifact hash is not present in candidate evidence')
}
if (!isInstallableSource('android', androidSourceArtifact)) {
  fail(119, 'android smoke source artifact must be an APK')
}

const iosSourceArtifact = findArtifactByHash(iosCandidate, iosSmoke.source_candidate_artifact_sha256)
if (!iosSourceArtifact) {
  fail(118, 'ios smoke source artifact hash is not present in candidate evidence')
}
if (!isInstallableSource('ios', iosSourceArtifact)) {
  fail(119, 'ios smoke source artifact must be an IPA')
}

const result = {
  schemaVersion: 1,
  product: policy.product,
  gate: 'F10A_RELEASE_ENGINEERING',
  status: 'PASS',
  version: androidCandidate.version,
  environment: 'qa',
  channel: 'beta',
  build: androidCandidate.build,
  nativeBuildNumber: androidCandidate.nativeBuildNumber,
  commit: androidCandidate.commit,
  webBundleSha256: androidCandidate.webBundleSha256,
  parityEvidenceSha256,
  productionLocked: true,
  android: {
    nativeBuildNumber: androidCandidate.nativeBuildNumber,
    nativeWebFileCount: androidCandidate.nativeWebVerification.nativeFileCount,
    nativeWebEvidenceSha256: androidCandidate.nativeWebVerification.evidenceSha256,
    candidateEvidenceSha256: androidCandidateEvidenceSha256,
    smokeExecutionId: androidSmoke.execution_id,
    sourceCandidateArtifactPath: androidSourceArtifact.path,
    sourceCandidateArtifactSha256: androidSmoke.source_candidate_artifact_sha256,
    installedArtifactSha256: androidSmoke.installed_artifact_sha256,
    installMethod: androidSmoke.install_method,
    signingProvenance: androidSmoke.signing_provenance,
  },
  ios: {
    nativeBuildNumber: iosCandidate.nativeBuildNumber,
    nativeWebFileCount: iosCandidate.nativeWebVerification.nativeFileCount,
    nativeWebEvidenceSha256: iosCandidate.nativeWebVerification.evidenceSha256,
    candidateEvidenceSha256: iosCandidateEvidenceSha256,
    smokeExecutionId: iosSmoke.execution_id,
    sourceCandidateArtifactPath: iosSourceArtifact.path,
    sourceCandidateArtifactSha256: iosSmoke.source_candidate_artifact_sha256,
    installedArtifactSha256: iosSmoke.installed_artifact_sha256,
    installMethod: iosSmoke.install_method,
    signingProvenance: iosSmoke.signing_provenance,
  },
  nextGate: 'F10B_NOT_AUTHORIZED',
  generatedAt: new Date().toISOString(),
}

const out = path.resolve(root, args.output)
fs.mkdirSync(path.dirname(out), { recursive: true })
fs.writeFileSync(out, JSON.stringify(result, null, 2) + '\n')

console.log('[PASS] F10A_RELEASE_ENGINEERING')
console.log(`[PASS] version=${result.version} commit=${result.commit}`)
console.log('[PASS] QA/BETA candidate accepted on Android and iOS')
console.log('[PASS] productionLocked=true')
console.log('[PASS] F10B_NOT_AUTHORIZED')
console.log(`[PASS] closure=${out}`)
