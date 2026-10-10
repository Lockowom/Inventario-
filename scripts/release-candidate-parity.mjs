import crypto from 'node:crypto'
import fs from 'node:fs'
import path from 'node:path'
import process from 'node:process'

function fail(code, message) {
  console.error(`[FAIL] ${message}`)
  process.exit(code)
}

function isSha256(value) {
  return /^[0-9a-f]{64}$/i.test(String(value ?? ''))
}

function fileSha256(file) {
  return crypto.createHash('sha256').update(fs.readFileSync(file)).digest('hex')
}

function relativeEvidencePath(root, value) {
  return path.relative(root, path.resolve(root, value)).replaceAll('\\', '/')
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

function validEvidencePath(value) {
  if (typeof value !== 'string' || !value || value.includes('\\')) return false
  const normalized = path.posix.normalize(value)
  return normalized === value
    && normalized !== '.'
    && !path.posix.isAbsolute(normalized)
    && !normalized.startsWith('../')
}

function validPlatformArtifacts(artifacts, platform) {
  if (!validArtifacts(artifacts)) return false
  const paths = artifacts.map((artifact) => artifact.path)
  if (paths.some((artifactPath) => !validEvidencePath(artifactPath))) return false
  if (new Set(paths).size !== paths.length) return false
  const extensions = paths.map((artifactPath) => path.extname(artifactPath).toLowerCase())
  if (platform === 'android') {
    return extensions.every((extension) => extension === '.apk' || extension === '.aab')
      && extensions.includes('.apk')
      && extensions.includes('.aab')
  }
  return extensions.every((extension) => extension === '.ipa') && extensions.includes('.ipa')
}

function validBuildIdentity(candidate) {
  const commit = String(candidate?.commit ?? '')
  const build = String(candidate?.build ?? '')
  return /^[0-9a-f]{40}$/i.test(commit)
    && new RegExp(`^${commit.slice(0, 8)}\\.\\d+$`, 'i').test(build)
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
    && validEvidencePath(evidence.evidencePath)
    && isSha256(evidence.evidenceSha256)
}

function parseArgs(argv) {
  const out = {
    android: 'artifacts/release/INVEN3-android-candidate-evidence.json',
    ios: 'artifacts/release/INVEN3-ios-candidate-evidence.json',
    output: 'artifacts/release/INVEN3-f10a-platform-parity.json',
  }
  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i]
    if (arg === '--android') out.android = argv[++i] || ''
    else if (arg === '--ios') out.ios = argv[++i] || ''
    else if (arg === '--out') out.output = argv[++i] || ''
    else fail(70, `unknown argument: ${arg}`)
  }
  return out
}

function readEvidence(root, value, expectedPlatform) {
  const full = path.resolve(root, value)
  if (!fs.existsSync(full)) fail(71, `${expectedPlatform} candidate evidence missing: ${value}`)
  let data
  try {
    data = JSON.parse(fs.readFileSync(full, 'utf8'))
  } catch {
    fail(71, `${expectedPlatform} candidate evidence is not valid JSON`)
  }
  if (data.schemaVersion !== 1 || data.gate !== 'F10A_RELEASE_CANDIDATE') {
    fail(72, `${expectedPlatform} candidate evidence schema/gate invalid`)
  }
  if (data.platform !== expectedPlatform) fail(72, `${value} platform ${data.platform} != ${expectedPlatform}`)
  if (data.status !== 'READY_FOR_BETA_SMOKE') fail(73, `${expectedPlatform} candidate is not READY_FOR_BETA_SMOKE`)
  if (data.productionLocked !== true) fail(74, `${expectedPlatform} candidate does not preserve production lock`)
  if (data.environment !== 'qa' || data.channel !== 'beta') fail(75, `${expectedPlatform} candidate is not QA/BETA`)
  if (!/^[0-9a-f]{40}$/i.test(String(data.commit ?? '')) || !isSha256(data.webBundleSha256)) {
    fail(76, `${expectedPlatform} candidate identity/hash is invalid`)
  }
  if (!validBuildIdentity(data) || !Number.isInteger(data.nativeBuildNumber) || data.nativeBuildNumber <= 0) {
    fail(76, `${expectedPlatform} candidate build identity is invalid`)
  }
  if (!validPlatformArtifacts(data.artifacts, expectedPlatform)) {
    fail(76, `${expectedPlatform} artifact evidence is invalid for platform`)
  }
  if (!validNativeWebVerification(data, expectedPlatform)) {
    fail(78, `${expectedPlatform} native web parity evidence is invalid`)
  }
  return data
}

const args = parseArgs(process.argv.slice(2))
const root = process.cwd()
const android = readEvidence(root, args.android, 'android')
const ios = readEvidence(root, args.ios, 'ios')
const androidCandidateEvidencePath = relativeEvidencePath(root, args.android)
const iosCandidateEvidencePath = relativeEvidencePath(root, args.ios)
if (!validEvidencePath(androidCandidateEvidencePath) || !validEvidencePath(iosCandidateEvidencePath)) {
  fail(79, 'candidate evidence inputs must stay inside the repository evidence root')
}
const androidCandidateEvidenceSha256 = fileSha256(path.resolve(root, args.android))
const iosCandidateEvidenceSha256 = fileSha256(path.resolve(root, args.ios))

const equalFields = ['product','gate','version','environment','channel','build','commit','webBundleSha256']
for (const field of equalFields) {
  if (android[field] !== ios[field]) {
    fail(77, `platform parity mismatch for ${field}: android=${android[field]} ios=${ios[field]}`)
  }
}
if (android.nativeBuildNumber !== ios.nativeBuildNumber) {
  fail(77, `platform parity mismatch for nativeBuildNumber: android=${android.nativeBuildNumber} ios=${ios.nativeBuildNumber}`)
}

const summary = {
  schemaVersion: 1,
  product: android.product,
  gate: 'F10A_PLATFORM_PARITY',
  status: 'READY_FOR_BETA_SMOKE',
  version: android.version,
  environment: android.environment,
  channel: android.channel,
  build: android.build,
  nativeBuildNumber: android.nativeBuildNumber,
  commit: android.commit,
  productionLocked: true,
  webBundleSha256: android.webBundleSha256,
  platforms: {
    android: {
      build: android.build,
      nativeBuildNumber: android.nativeBuildNumber,
      candidateEvidencePath: androidCandidateEvidencePath,
      candidateEvidenceSha256: androidCandidateEvidenceSha256,
      nativeWebVerification: android.nativeWebVerification,
      artifacts: android.artifacts,
    },
    ios: {
      build: ios.build,
      nativeBuildNumber: ios.nativeBuildNumber,
      candidateEvidencePath: iosCandidateEvidencePath,
      candidateEvidenceSha256: iosCandidateEvidenceSha256,
      nativeWebVerification: ios.nativeWebVerification,
      artifacts: ios.artifacts,
    },
  },
  generatedAt: new Date().toISOString(),
}

const out = path.resolve(root, args.output)
fs.mkdirSync(path.dirname(out), { recursive: true })
fs.writeFileSync(out, JSON.stringify(summary, null, 2) + '\n')

console.log('[PASS] F10A_PLATFORM_PARITY')
console.log(`[PASS] commit=${summary.commit} version=${summary.version} env=${summary.environment} channel=${summary.channel}`)
console.log(`[PASS] webBundleSha256=${summary.webBundleSha256}`)
console.log('[PASS] native web bundle verified inside Android and iOS projects')
console.log(`[PASS] evidence=${out}`)
