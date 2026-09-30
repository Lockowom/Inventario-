import crypto from 'node:crypto'
import fs from 'node:fs'
import path from 'node:path'
import process from 'node:process'

function fail(code, message) {
  console.error(`[FAIL] ${message}`)
  process.exit(code)
}

function sha256(file) {
  return crypto.createHash('sha256').update(fs.readFileSync(file)).digest('hex')
}

function parseArgs(argv) {
  const out = {
    platform: '',
    manifest: 'artifacts/release/INVEN3-release-manifest.json',
    nativeDir: '',
    output: '',
  }
  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i]
    if (arg === '--platform') out.platform = argv[++i] || ''
    else if (arg === '--manifest') out.manifest = argv[++i] || ''
    else if (arg === '--native-dir') out.nativeDir = argv[++i] || ''
    else if (arg === '--out') out.output = argv[++i] || ''
    else fail(120, `unknown argument: ${arg}`)
  }
  return out
}

function readJson(file, label) {
  if (!fs.existsSync(file)) fail(121, `${label} not found: ${file}`)
  try {
    return JSON.parse(fs.readFileSync(file, 'utf8'))
  } catch {
    fail(122, `${label} is not valid JSON`)
  }
}

function validManifestPath(value) {
  if (typeof value !== 'string' || !value.length || value.includes('\\')) return false
  if (path.posix.isAbsolute(value)) return false
  const normalized = path.posix.normalize(value)
  return normalized === value && normalized !== '.' && !normalized.startsWith('../')
}

function collectNativeFiles(baseDir, currentDir = baseDir) {
  const files = []
  for (const entry of fs.readdirSync(currentDir, { withFileTypes: true })) {
    const full = path.join(currentDir, entry.name)
    if (entry.isSymbolicLink()) {
      fail(130, `native web directory contains a symbolic link: ${path.relative(baseDir, full).replaceAll('\\', '/')}`)
    }
    if (entry.isDirectory()) {
      files.push(...collectNativeFiles(baseDir, full))
      continue
    }
    if (!entry.isFile()) {
      fail(130, `native web directory contains an unsupported entry: ${path.relative(baseDir, full).replaceAll('\\', '/')}`)
    }
    files.push(path.relative(baseDir, full).replaceAll('\\', '/'))
  }
  return files.sort((a, b) => a.localeCompare(b))
}

const args = parseArgs(process.argv.slice(2))
if (!['android', 'ios'].includes(args.platform)) fail(123, '--platform must be android or ios')

const root = process.cwd()
const policy = readJson(path.join(root, 'release-policy.json'), 'release policy')
const manifestPath = path.resolve(root, args.manifest)
const manifest = readJson(manifestPath, 'release manifest')
const defaultNativeDir = args.platform === 'android'
  ? 'android/app/src/main/assets/public'
  : 'ios/App/App/public'
const nativeDir = path.resolve(root, args.nativeDir || defaultNativeDir)

if (policy.productionLocked !== true || manifest.productionLocked !== true) {
  fail(124, 'native web verification requires productionLocked=true')
}
if (manifest.schemaVersion !== 1 || manifest.product !== policy.product) {
  fail(124, 'release manifest identity is invalid')
}
if (manifest.version !== policy.releaseVersion || manifest.environment !== 'qa' || manifest.channel !== 'beta') {
  fail(124, 'release manifest is not the authorized QA/BETA version')
}
if (!/^[0-9a-f]{40}$/i.test(String(manifest.commit ?? '')) || !manifest.build) {
  fail(124, 'release manifest candidate identity is incomplete')
}
if (!fs.existsSync(nativeDir) || !fs.statSync(nativeDir).isDirectory()) {
  fail(125, `native web directory not found: ${path.relative(root, nativeDir)}`)
}

const bundle = manifest.webBundle
if (!bundle || !Array.isArray(bundle.files) || bundle.files.length === 0) {
  fail(126, 'release manifest web bundle is empty')
}
if (bundle.fileCount !== bundle.files.length) {
  fail(126, 'release manifest fileCount does not match files')
}

const seen = new Set()
for (const file of bundle.files) {
  if (!file || !validManifestPath(file.path)) fail(126, 'release manifest contains an unsafe web path')
  if (seen.has(file.path)) fail(126, `release manifest contains duplicate path: ${file.path}`)
  seen.add(file.path)
  if (!/^[0-9a-f]{64}$/i.test(String(file.sha256 ?? ''))) {
    fail(126, `release manifest hash is invalid: ${file.path}`)
  }
  if (!Number.isInteger(file.bytes) || file.bytes < 0) {
    fail(126, `release manifest byte count is invalid: ${file.path}`)
  }
}

const sorted = [...bundle.files].sort((a, b) => a.path.localeCompare(b.path))
const aggregate = crypto.createHash('sha256')
  .update(Buffer.from(sorted.map((file) => `${file.path}:${file.sha256}:${file.bytes}`).join('\n')))
  .digest('hex')
if (aggregate !== bundle.aggregateSha256) {
  fail(127, 'release manifest aggregate SHA-256 is inconsistent')
}

for (const file of sorted) {
  const nativeFile = path.resolve(nativeDir, ...file.path.split('/'))
  const relative = path.relative(nativeDir, nativeFile)
  if (relative.startsWith('..') || path.isAbsolute(relative)) {
    fail(126, `native web path escapes target directory: ${file.path}`)
  }
  if (!fs.existsSync(nativeFile) || !fs.statSync(nativeFile).isFile()) {
    fail(128, `certified web file missing from ${args.platform}: ${file.path}`)
  }
  const stat = fs.statSync(nativeFile)
  if (stat.size !== file.bytes || sha256(nativeFile) !== file.sha256) {
    fail(129, `certified web file mismatch in ${args.platform}: ${file.path}`)
  }
}

const nativeFiles = collectNativeFiles(nativeDir)
const allowedGeneratedBridgeFiles = new Set(['cordova.js', 'cordova_plugins.js'])
const generatedBridgeFiles = nativeFiles.filter((file) => !seen.has(file) && allowedGeneratedBridgeFiles.has(file))
const uncertifiedFiles = nativeFiles.filter((file) => !seen.has(file) && !allowedGeneratedBridgeFiles.has(file))
if (uncertifiedFiles.length > 0) {
  fail(130, `uncertified native web file in ${args.platform}: ${uncertifiedFiles[0]}`)
}
const certifiedNativeFiles = nativeFiles.filter((file) => seen.has(file))
if (certifiedNativeFiles.length !== sorted.length) {
  fail(130, `native certified web file set mismatch in ${args.platform}: manifest=${sorted.length} native=${certifiedNativeFiles.length}`)
}

const generatedBridgeEvidence = generatedBridgeFiles.map((relativePath) => {
  const full = path.resolve(nativeDir, ...relativePath.split('/'))
  const stat = fs.statSync(full)
  return {
    path: relativePath,
    bytes: stat.size,
    sha256: sha256(full),
  }
})

const evidence = {
  schemaVersion: 1,
  product: policy.product,
  gate: 'F10A_NATIVE_WEB_PARITY',
  status: 'PASS',
  platform: args.platform,
  version: manifest.version,
  environment: manifest.environment,
  channel: manifest.channel,
  build: manifest.build,
  commit: manifest.commit,
  productionLocked: true,
  webBundleSha256: bundle.aggregateSha256,
  verifiedFileCount: sorted.length,
  nativeFileCount: certifiedNativeFiles.length,
  nativeDirectoryFileCount: nativeFiles.length,
  generatedBridgeFiles: generatedBridgeEvidence,
  nativeDirectory: path.relative(root, nativeDir).replaceAll('\\', '/'),
  generatedAt: new Date().toISOString(),
}

const out = path.resolve(
  root,
  args.output || `artifacts/release/INVEN3-${args.platform}-native-web-evidence.json`,
)
fs.mkdirSync(path.dirname(out), { recursive: true })
fs.writeFileSync(out, JSON.stringify(evidence, null, 2) + '\n')

console.log(`[PASS] F10A_NATIVE_WEB_PARITY platform=${args.platform}`)
console.log(`[PASS] files=${evidence.verifiedFileCount} generatedBridgeFiles=${evidence.generatedBridgeFiles.length} webBundleSha256=${evidence.webBundleSha256}`)
console.log(`[PASS] evidence=${out}`)
