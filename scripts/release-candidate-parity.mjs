import fs from 'node:fs'
import path from 'node:path'
import process from 'node:process'

function fail(code, message) {
  console.error(`[FAIL] ${message}`)
  process.exit(code)
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
  const data = JSON.parse(fs.readFileSync(full, 'utf8'))
  if (data.platform !== expectedPlatform) fail(72, `${value} platform ${data.platform} != ${expectedPlatform}`)
  if (data.status !== 'READY_FOR_BETA_SMOKE') fail(73, `${expectedPlatform} candidate is not READY_FOR_BETA_SMOKE`)
  if (data.productionLocked !== true) fail(74, `${expectedPlatform} candidate does not preserve production lock`)
  if (data.environment !== 'qa' || data.channel !== 'beta') fail(75, `${expectedPlatform} candidate is not QA/BETA`)
  if (!Array.isArray(data.artifacts) || data.artifacts.length === 0) fail(76, `${expectedPlatform} artifact evidence is empty`)
  return data
}

const args = parseArgs(process.argv.slice(2))
const root = process.cwd()
const android = readEvidence(root, args.android, 'android')
const ios = readEvidence(root, args.ios, 'ios')

const equalFields = ['product','gate','version','environment','channel','commit','webBundleSha256']
for (const field of equalFields) {
  if (android[field] !== ios[field]) {
    fail(77, `platform parity mismatch for ${field}: android=${android[field]} ios=${ios[field]}`)
  }
}

const summary = {
  schemaVersion: 1,
  product: android.product,
  gate: 'F10A_PLATFORM_PARITY',
  status: 'READY_FOR_BETA_SMOKE',
  version: android.version,
  environment: android.environment,
  channel: android.channel,
  commit: android.commit,
  productionLocked: true,
  webBundleSha256: android.webBundleSha256,
  platforms: {
    android: {
      build: android.build,
      nativeBuildNumber: android.nativeBuildNumber,
      artifacts: android.artifacts,
    },
    ios: {
      build: ios.build,
      nativeBuildNumber: ios.nativeBuildNumber,
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
console.log(`[PASS] evidence=${out}`)
