import fs from 'node:fs'
import path from 'node:path'
import process from 'node:process'

function fail(code, message) {
  console.error(`[FAIL] ${message}`)
  process.exit(code)
}

function collect(dir) {
  if (!fs.existsSync(dir)) return []
  return fs.readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
    const full = path.join(dir, entry.name)
    return entry.isDirectory() ? collect(full) : [full]
  })
}

const root = process.cwd()
const policy = JSON.parse(fs.readFileSync(path.join(root, 'release-policy.json'), 'utf8'))
const dist = path.join(root, 'dist')
const files = collect(dist)

if (files.length === 0) fail(60, 'dist/ is empty; build the QA/BETA bundle before auditing it')
if (policy.productionLocked !== true) fail(61, 'bundle audit requires productionLocked=true during F10A')

const readable = files.filter((file) => {
  const ext = path.extname(file).toLowerCase()
  return ['.js','.css','.html','.json','.map','.txt','.svg','.xml'].includes(ext)
})
const content = readable.map((file) => fs.readFileSync(file, 'utf8')).join('\n')

const qaHost = `${policy.qaSupabaseProjectRef}.supabase.co`
if (!content.includes(qaHost)) fail(62, `built bundle does not contain authorized QA backend host ${qaHost}`)

const bundledSupabaseHosts = [...content.matchAll(/(?:https?:\/\/)?([a-z0-9]{20}\.supabase\.co)/gi)]
  .map((match) => match[1].toLowerCase())
const foreignHosts = [...new Set(bundledSupabaseHosts.filter((host) => host !== qaHost))]
if (foreignHosts.length > 0) fail(63, `built bundle contains unauthorized Supabase host: ${foreignHosts.join(', ')}`)

const jwtCandidates = content.match(/eyJ[A-Za-z0-9_-]{8,}\.[A-Za-z0-9_-]{8,}\.[A-Za-z0-9_-]+/g) ?? []
for (const token of jwtCandidates) {
  try {
    const payload = JSON.parse(Buffer.from(token.split('.')[1], 'base64url').toString('utf8'))
    if (String(payload?.role ?? '').toLowerCase() === 'service_role') {
      fail(63, 'built bundle contains a Supabase service_role JWT')
    }
  } catch {
    // Ignore non-JWT text fragments that only match the token shape.
  }
}

const forbidden = [
  { label: 'localhost Supabase', regex: /(?:127\.0\.0\.1|localhost)(?::54321)?/i },
  { label: 'Supabase server secret key', regex: /sb_secret_[A-Za-z0-9._-]+/ },
  { label: 'service-role environment variable', regex: /SUPABASE_SERVICE_ROLE_KEY/ },
]

for (const item of forbidden) {
  if (item.regex.test(content)) fail(63, `built bundle contains forbidden reference: ${item.label}`)
}

const jsFiles = files.filter((file) => /\.js$/i.test(file))
if (jsFiles.length === 0) fail(64, 'built bundle has no JavaScript payload')

const totalBytes = files.reduce((sum, file) => sum + fs.statSync(file).size, 0)
console.log(`[PASS] F10A_BUNDLE_AUDIT files=${files.length} bytes=${totalBytes}`)
console.log(`[PASS] authorized backend=${qaHost}`)
console.log('[PASS] no localhost/server-secret references detected')
console.log('[PASS] production remains locked')
