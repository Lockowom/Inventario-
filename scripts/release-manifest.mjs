import crypto from 'node:crypto'
import fs from 'node:fs'
import path from 'node:path'
import process from 'node:process'
import { execFileSync } from 'node:child_process'

const root = process.cwd()
const policy = JSON.parse(fs.readFileSync(path.join(root, 'release-policy.json'), 'utf8'))
const dist = path.join(root, 'dist')

function sha256(buffer) {
  return crypto.createHash('sha256').update(buffer).digest('hex')
}

function collectFiles(dir, base = dir) {
  if (!fs.existsSync(dir)) return []
  return fs.readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
    const full = path.join(dir, entry.name)
    if (entry.isSymbolicLink()) throw new Error(`Release manifest refuses symbolic link in dist/: ${path.relative(base, full)}`)
    if (entry.isDirectory()) return collectFiles(full, base)
    if (!entry.isFile()) throw new Error(`Release manifest refuses unsupported dist entry: ${path.relative(base, full)}`)
    return [{
      path: path.relative(base, full).replaceAll('\\', '/'),
      sha256: sha256(fs.readFileSync(full)),
      bytes: fs.statSync(full).size,
    }]
  })
}

function resolveCommit() {
  const envSha = process.env.INVEN3_CANDIDATE_SHA || process.env.GITHUB_SHA || process.env.CM_COMMIT
  if (envSha) {
    if (!/^[0-9a-f]{40}$/i.test(envSha)) {
      throw new Error(`Release manifest requires a full 40-character candidate SHA, got: ${envSha}`)
    }
    return envSha.toLowerCase()
  }
  try { return execFileSync('git', ['rev-parse', 'HEAD'], { encoding: 'utf8' }).trim() }
  catch { return 'UNKNOWN' }
}

const files = collectFiles(dist).sort((a, b) => a.path.localeCompare(b.path))
if (files.length === 0) throw new Error('Release manifest requires a non-empty dist/ bundle. Run the build first.')
if (policy.productionLocked !== true) throw new Error('Release manifest requires productionLocked=true during F10A.')
const aggregate = sha256(Buffer.from(files.map((file) => `${file.path}:${file.sha256}:${file.bytes}`).join('\n')))
const environment = process.env.VITE_RELEASE_ENV || policy.defaultEnvironment
const channel = process.env.VITE_RELEASE_CHANNEL || policy.defaultChannel
const commit = resolveCommit()
if (!/^[0-9a-f]{40}$/i.test(commit)) throw new Error('Release manifest requires a resolvable full candidate SHA.')
const build = process.env.VITE_APP_BUILD || null
if (!build || !new RegExp(`^${commit.slice(0, 8)}\\.\\d+$`, 'i').test(build)) {
  throw new Error('Release manifest build identity must be <candidate-sha8>.<run-number>.')
}
const nativeBuildNumberRaw = process.env.INVEN3_NATIVE_BUILD_NUMBER || ''
const nativeBuildNumber = /^\d+$/.test(nativeBuildNumberRaw) ? Number(nativeBuildNumberRaw) : null
const buildRunNumber = Number(build.split('.')[1])
const androidBase = policy.native?.androidBaseVersionCode
const iosBase = policy.native?.iosBaseBuildNumber
if (!Number.isInteger(androidBase) || !Number.isInteger(iosBase) || androidBase !== iosBase) {
  throw new Error('Release manifest requires equal integer Android/iOS native base build numbers for F10A.')
}
if (!Number.isInteger(nativeBuildNumber) || nativeBuildNumber !== androidBase + buildRunNumber) {
  throw new Error('Release manifest native build number is not bound to the candidate run number.')
}

const manifest = {
  schemaVersion: 1,
  product: policy.product,
  version: policy.releaseVersion,
  environment,
  channel,
  build,
  commit,
  productionLocked: policy.productionLocked,
  generatedAt: new Date().toISOString(),
  native: {
    ...policy.native,
    effectiveBuildNumber: nativeBuildNumber,
  },
  webBundle: {
    fileCount: files.length,
    aggregateSha256: aggregate,
    files,
  },
}

const outDir = path.join(root, 'artifacts', 'release')
fs.mkdirSync(outDir, { recursive: true })
const out = path.join(outDir, 'INVEN3-release-manifest.json')
fs.writeFileSync(out, JSON.stringify(manifest, null, 2) + '\n')
console.log(`[PASS] RELEASE_MANIFEST ${out}`)
console.log(`[PASS] WEB_BUNDLE_SHA256 ${aggregate}`)
