import crypto from 'node:crypto'
import fs from 'node:fs'
import path from 'node:path'
import process from 'node:process'
import { execFileSync } from 'node:child_process'

function fail(code, message) {
  console.error(`[FAIL] ${message}`)
  process.exit(code)
}

function sha256(file) {
  return crypto.createHash('sha256').update(fs.readFileSync(file)).digest('hex')
}

function isSha256(value) {
  return /^[0-9a-f]{64}$/i.test(String(value ?? ''))
}

function currentCommit() {
  if (process.env.INVEN3_CANDIDATE_SHA) return process.env.INVEN3_CANDIDATE_SHA
  if (process.env.GITHUB_SHA) return process.env.GITHUB_SHA
  if (process.env.CM_COMMIT) return process.env.CM_COMMIT
  try {
    return execFileSync('git', ['rev-parse', 'HEAD'], { encoding: 'utf8' }).trim()
  } catch {
    return null
  }
}

function parseArgs(argv) {
  const out = {
    platform: '',
    artifacts: [],
    manifest: 'artifacts/release/INVEN3-release-manifest.json',
    nativeWebEvidence: '',
    output: '',
  }
  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i]
    if (arg === '--platform') out.platform = argv[++i] || ''
    else if (arg === '--artifact') out.artifacts.push(argv[++i] || '')
    else if (arg === '--manifest') out.manifest = argv[++i] || ''
    else if (arg === '--native-web-evidence') out.nativeWebEvidence = argv[++i] || ''
    else if (arg === '--out') out.output = argv[++i] || ''
    else fail(40, `unknown argument: ${arg}`)
  }
  return out
}

function readJson(file, label, missingCode, invalidCode) {
  if (!fs.existsSync(file)) fail(missingCode, `${label} not found: ${file}`)
  try {
    return JSON.parse(fs.readFileSync(file, 'utf8'))
  } catch {
    fail(invalidCode, `${label} is not valid JSON`)
  }
}

function repoRelativeFile(root, file, label) {
  if (!fs.existsSync(file)) fail(65, `${label} not found: ${file}`)
  if (fs.lstatSync(file).isSymbolicLink()) fail(65, `${label} must not be a symbolic link`)
  const rootReal = fs.realpathSync(root)
  const fileReal = fs.realpathSync(file)
  const relative = path.relative(rootReal, fileReal)
  if (!relative || relative.startsWith('..') || path.isAbsolute(relative)) {
    fail(65, `${label} must stay inside repository root`)
  }
  return relative.replaceAll('\\', '/')
}

function validBuildIdentity(manifest) {
  const commit = String(manifest?.commit ?? '')
  const build = String(manifest?.build ?? '')
  return /^[0-9a-f]{40}$/i.test(commit)
    && new RegExp(`^${commit.slice(0, 8)}\\.\\d+$`, 'i').test(build)
}

function validateManifestFiles(manifest) {
  const bundle = manifest?.webBundle
  if (!bundle || !Array.isArray(bundle.files) || bundle.files.length === 0) {
    fail(54, 'manifest web bundle evidence is incomplete')
  }
  if (bundle.fileCount !== bundle.files.length || !isSha256(bundle.aggregateSha256)) {
    fail(64, 'manifest web bundle metadata is inconsistent')
  }
  const seen = new Set()
  for (const file of bundle.files) {
    if (!file || typeof file.path !== 'string' || !file.path.length || file.path.includes('\\')) {
      fail(64, 'manifest web bundle path is invalid')
    }
    const normalized = path.posix.normalize(file.path)
    if (path.posix.isAbsolute(file.path) || normalized !== file.path || normalized.startsWith('../')) {
      fail(64, `manifest web bundle path is unsafe: ${file.path}`)
    }
    if (seen.has(file.path)) fail(64, `manifest web bundle path is duplicated: ${file.path}`)
    seen.add(file.path)
    if (!isSha256(file.sha256) || !Number.isInteger(file.bytes) || file.bytes < 0) {
      fail(64, `manifest web bundle file evidence is invalid: ${file.path}`)
    }
  }
  const sorted = [...bundle.files].sort((a, b) => a.path.localeCompare(b.path))
  const aggregate = crypto.createHash('sha256')
    .update(Buffer.from(sorted.map((file) => `${file.path}:${file.sha256}:${file.bytes}`).join('\n')))
    .digest('hex')
  if (aggregate !== bundle.aggregateSha256) fail(64, 'manifest aggregate SHA-256 is inconsistent')
}

const args = parseArgs(process.argv.slice(2))
if (!['android', 'ios'].includes(args.platform)) fail(41, '--platform must be android or ios')
if (args.artifacts.length === 0) fail(42, 'at least one --artifact is required')
if (!args.nativeWebEvidence) fail(60, '--native-web-evidence is required')

const root = process.cwd()
const policyPath = path.join(root, 'release-policy.json')
const manifestPath = path.resolve(root, args.manifest)
const nativeWebEvidencePath = path.resolve(root, args.nativeWebEvidence)

if (!fs.existsSync(policyPath)) fail(43, 'release-policy.json not found')
const policy = readJson(policyPath, 'release policy', 43, 43)
const manifest = readJson(manifestPath, 'release manifest', 44, 44)
const nativeWeb = readJson(nativeWebEvidencePath, 'native web evidence', 61, 61)
repoRelativeFile(root, manifestPath, 'release manifest')
const nativeWebEvidenceRelativePath = repoRelativeFile(root, nativeWebEvidencePath, 'native web evidence')

if (policy.productionLocked !== true) fail(45, 'candidate verifier requires productionLocked=true')
if (manifest.productionLocked !== true) fail(46, 'manifest does not preserve production lock')
if (manifest.schemaVersion !== 1 || manifest.product !== policy.product) fail(64, 'manifest product/schema is not aligned with policy')
if (manifest.environment !== 'qa') fail(47, `candidate environment must be qa, got ${manifest.environment}`)
if (manifest.channel !== 'beta') fail(48, `candidate channel must be beta, got ${manifest.channel}`)
if (manifest.version !== policy.releaseVersion) fail(49, 'manifest release version is not aligned with policy')

const effectiveBuildNumber = manifest?.native?.effectiveBuildNumber
if (!Number.isInteger(effectiveBuildNumber)) fail(50, 'manifest native.effectiveBuildNumber is missing or invalid')
const baseBuild = args.platform === 'android'
  ? policy.native.androidBaseVersionCode
  : policy.native.iosBaseBuildNumber
if (effectiveBuildNumber < baseBuild) fail(51, `effective native build ${effectiveBuildNumber} is below policy base ${baseBuild}`)

const commit = currentCommit()
if (!/^[0-9a-f]{40}$/i.test(String(manifest.commit ?? ''))) fail(52, 'manifest commit is not a full SHA')
if (commit && manifest.commit.toLowerCase() !== String(commit).toLowerCase()) {
  fail(52, `manifest commit ${manifest.commit} != current commit ${commit}`)
}
if (!validBuildIdentity(manifest)) {
  fail(53, 'manifest build identity is not bound to the candidate commit')
}
validateManifestFiles(manifest)

if (nativeWeb.gate !== 'F10A_NATIVE_WEB_PARITY'
  || nativeWeb.status !== 'PASS'
  || nativeWeb.platform !== args.platform
  || nativeWeb.productionLocked !== true) {
  fail(62, 'native web evidence gate/platform/status is invalid')
}
for (const field of ['product','version','environment','channel','build','commit']) {
  if (nativeWeb[field] !== manifest[field]) fail(63, `native web evidence mismatch: ${field}`)
}
if (nativeWeb.webBundleSha256 !== manifest.webBundle.aggregateSha256) {
  fail(63, 'native web evidence bundle SHA-256 mismatch')
}
if (nativeWeb.verifiedFileCount !== manifest.webBundle.files.length
  || !Number.isInteger(nativeWeb.verifiedFileCount)
  || nativeWeb.verifiedFileCount <= 0) {
  fail(63, 'native web evidence file count mismatch')
}
if (!Number.isInteger(nativeWeb.nativeFileCount)
  || nativeWeb.nativeFileCount <= 0
  || nativeWeb.nativeFileCount !== nativeWeb.verifiedFileCount) {
  fail(63, 'native web evidence exact file set count mismatch')
}
if (typeof nativeWeb.nativeDirectory !== 'string' || !nativeWeb.nativeDirectory.trim()) {
  fail(62, 'native web evidence directory is missing')
}

const artifacts = args.artifacts.map((value) => {
  const full = path.resolve(root, value)
  if (!fs.existsSync(full)) fail(55, `candidate artifact not found: ${value}`)
  const artifactPath = repoRelativeFile(root, full, 'candidate artifact')
  const stat = fs.statSync(full)
  if (!stat.isFile() || stat.size <= 0) fail(56, `candidate artifact is empty or not a file: ${value}`)
  return {
    path: artifactPath,
    bytes: stat.size,
    sha256: sha256(full),
  }
})

const artifactPaths = artifacts.map((artifact) => artifact.path)
if (new Set(artifactPaths).size !== artifactPaths.length) {
  fail(57, 'candidate artifact list contains duplicate paths')
}

const extensions = artifactPaths.map((artifactPath) => path.extname(artifactPath).toLowerCase())
if (args.platform === 'android') {
  const allowed = new Set(['.apk', '.aab'])
  if (extensions.some((extension) => !allowed.has(extension))
    || !extensions.includes('.apk')
    || !extensions.includes('.aab')) {
    fail(58, 'android candidate must contain APK and AAB artifacts only')
  }
} else if (extensions.some((extension) => extension !== '.ipa') || !extensions.includes('.ipa')) {
  fail(59, 'ios candidate must contain IPA artifacts only')
}

const evidence = {
  schemaVersion: 1,
  product: policy.product,
  gate: 'F10A_RELEASE_CANDIDATE',
  status: 'READY_FOR_BETA_SMOKE',
  platform: args.platform,
  version: manifest.version,
  environment: manifest.environment,
  channel: manifest.channel,
  build: manifest.build,
  nativeBuildNumber: effectiveBuildNumber,
  commit: manifest.commit,
  productionLocked: true,
  webBundleSha256: manifest.webBundle.aggregateSha256,
  nativeWebVerification: {
    gate: nativeWeb.gate,
    status: nativeWeb.status,
    platform: nativeWeb.platform,
    verifiedFileCount: nativeWeb.verifiedFileCount,
    nativeFileCount: nativeWeb.nativeFileCount,
    webBundleSha256: nativeWeb.webBundleSha256,
    evidencePath: nativeWebEvidenceRelativePath,
    evidenceSha256: sha256(nativeWebEvidencePath),
  },
  artifacts,
  generatedAt: new Date().toISOString(),
}

const outPath = path.resolve(
  root,
  args.output || `artifacts/release/INVEN3-${args.platform}-candidate-evidence.json`,
)
fs.mkdirSync(path.dirname(outPath), { recursive: true })
fs.writeFileSync(outPath, JSON.stringify(evidence, null, 2) + '\n')

console.log(`[PASS] F10A_RELEASE_CANDIDATE ${args.platform}`)
console.log(`[PASS] READY_FOR_BETA_SMOKE build=${manifest.build} native=${effectiveBuildNumber}`)
console.log(`[PASS] NATIVE_WEB_PARITY files=${nativeWeb.verifiedFileCount} sha256=${nativeWeb.webBundleSha256}`)
for (const artifact of artifacts) {
  console.log(`[PASS] ARTIFACT ${artifact.path} ${artifact.bytes} bytes sha256=${artifact.sha256}`)
}
console.log(`[PASS] EVIDENCE ${outPath}`)
