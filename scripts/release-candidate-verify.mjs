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
  const out = { platform: '', artifacts: [], manifest: 'artifacts/release/INVEN3-release-manifest.json', output: '' }
  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i]
    if (arg === '--platform') out.platform = argv[++i] || ''
    else if (arg === '--artifact') out.artifacts.push(argv[++i] || '')
    else if (arg === '--manifest') out.manifest = argv[++i] || ''
    else if (arg === '--out') out.output = argv[++i] || ''
    else fail(40, `unknown argument: ${arg}`)
  }
  return out
}

const args = parseArgs(process.argv.slice(2))
if (!['android', 'ios'].includes(args.platform)) fail(41, '--platform must be android or ios')
if (args.artifacts.length === 0) fail(42, 'at least one --artifact is required')

const root = process.cwd()
const policyPath = path.join(root, 'release-policy.json')
const manifestPath = path.resolve(root, args.manifest)

if (!fs.existsSync(policyPath)) fail(43, 'release-policy.json not found')
if (!fs.existsSync(manifestPath)) fail(44, `release manifest not found: ${args.manifest}`)

const policy = JSON.parse(fs.readFileSync(policyPath, 'utf8'))
const manifest = JSON.parse(fs.readFileSync(manifestPath, 'utf8'))

if (policy.productionLocked !== true) fail(45, 'candidate verifier requires productionLocked=true')
if (manifest.productionLocked !== true) fail(46, 'manifest does not preserve production lock')
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
if (commit && manifest.commit !== commit) fail(52, `manifest commit ${manifest.commit} != current commit ${commit}`)
if (!manifest.build) fail(53, 'manifest build identity is missing')
if (!manifest?.webBundle?.aggregateSha256 || !Array.isArray(manifest?.webBundle?.files) || manifest.webBundle.files.length === 0) {
  fail(54, 'manifest web bundle evidence is incomplete')
}

const artifacts = args.artifacts.map((value) => {
  const full = path.resolve(root, value)
  if (!fs.existsSync(full)) fail(55, `candidate artifact not found: ${value}`)
  const stat = fs.statSync(full)
  if (!stat.isFile() || stat.size <= 0) fail(56, `candidate artifact is empty or not a file: ${value}`)
  return {
    path: path.relative(root, full).replaceAll('\\', '/'),
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
for (const artifact of artifacts) {
  console.log(`[PASS] ARTIFACT ${artifact.path} ${artifact.bytes} bytes sha256=${artifact.sha256}`)
}
console.log(`[PASS] EVIDENCE ${outPath}`)
