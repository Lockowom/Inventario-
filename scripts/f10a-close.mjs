import fs from 'node:fs'
import path from 'node:path'
import process from 'node:process'

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

function hasOpenBlockingDefect(defects) {
  return Array.isArray(defects) && defects.some((defect) =>
    ['BLOCKER','CRITICAL'].includes(String(defect?.severity ?? '').toUpperCase())
    && String(defect?.status ?? '').toUpperCase() === 'OPEN'
  )
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

for (const [label, candidate, platform] of [
  ['android candidate', androidCandidate, 'android'],
  ['ios candidate', iosCandidate, 'ios'],
]) {
  if (candidate.gate !== 'F10A_RELEASE_CANDIDATE') fail(95, `${label} gate invalid`)
  if (candidate.status !== 'READY_FOR_BETA_SMOKE') fail(96, `${label} is not READY_FOR_BETA_SMOKE`)
  if (candidate.platform !== platform) fail(97, `${label} platform mismatch`)
  if (candidate.environment !== 'qa' || candidate.channel !== 'beta') fail(98, `${label} is not QA/BETA`)
  if (candidate.productionLocked !== true) fail(99, `${label} production lock missing`)
}

if (parity.gate !== 'F10A_PLATFORM_PARITY' || parity.status !== 'READY_FOR_BETA_SMOKE') {
  fail(100, 'platform parity is not READY_FOR_BETA_SMOKE')
}
if (parity.productionLocked !== true) fail(101, 'platform parity lost production lock')

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

const fields = ['version','environment','channel','commit','webBundleSha256']
for (const field of fields) {
  if (androidCandidate[field] !== iosCandidate[field]) fail(108, `candidate mismatch: ${field}`)
  if (parity[field] !== androidCandidate[field]) fail(109, `parity mismatch: ${field}`)
}

if (androidSmoke.candidate_sha !== androidCandidate.commit) fail(110, 'android smoke candidate SHA mismatch')
if (iosSmoke.candidate_sha !== iosCandidate.commit) fail(111, 'ios smoke candidate SHA mismatch')
if (androidSmoke.version !== androidCandidate.version || iosSmoke.version !== iosCandidate.version) fail(112, 'smoke version mismatch')
if (androidSmoke.native_build_number !== androidCandidate.nativeBuildNumber) fail(113, 'android smoke native build mismatch')
if (iosSmoke.native_build_number !== iosCandidate.nativeBuildNumber) fail(114, 'ios smoke native build mismatch')

const result = {
  schemaVersion: 1,
  product: policy.product,
  gate: 'F10A_RELEASE_ENGINEERING',
  status: 'PASS',
  version: androidCandidate.version,
  environment: 'qa',
  channel: 'beta',
  commit: androidCandidate.commit,
  webBundleSha256: androidCandidate.webBundleSha256,
  productionLocked: true,
  android: {
    nativeBuildNumber: androidCandidate.nativeBuildNumber,
    smokeExecutionId: androidSmoke.execution_id,
  },
  ios: {
    nativeBuildNumber: iosCandidate.nativeBuildNumber,
    smokeExecutionId: iosSmoke.execution_id,
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
