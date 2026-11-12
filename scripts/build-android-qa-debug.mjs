import { execFileSync, spawnSync } from 'node:child_process'
import crypto from 'node:crypto'
import fs from 'node:fs'
import { resolve } from 'node:path'
import { readVersionConfig } from './versioning.mjs'

const projectRef = 'kpsdephjbvkwvazxubtb'
const qaUrl = `https://${projectRef}.supabase.co`
const version = readVersionConfig(resolve('version.json'))

function run(command, args, options = {}) {
  const invocation = process.platform === 'win32'
    ? {
        command: 'cmd.exe',
        args: ['/d', '/s', '/c', [command, ...args]
          .map((part) => (/^[A-Za-z0-9_./:=+-]+$/.test(part) ? part : `"${part.replaceAll('"', '\\"')}"`))
          .join(' ')],
      }
    : { command, args }
  const result = spawnSync(invocation.command, invocation.args, { stdio: 'inherit', ...options })
  if (result.status !== 0) process.exit(result.status ?? 1)
}

const command = process.platform === 'win32' ? 'cmd.exe' : 'supabase'
const args = process.platform === 'win32'
  ? ['/d', '/s', '/c', `%APPDATA%\\npm\\supabase.cmd projects api-keys --project-ref ${projectRef} --reveal --output json`]
  : ['projects', 'api-keys', '--project-ref', projectRef, '--reveal', '--output', 'json']
const rows = JSON.parse(execFileSync(command, args, { encoding: 'utf8', windowsHide: true }))
// Prefer Supabase's current browser-safe publishable key.  The legacy anon
// key remains a compatibility fallback only for projects that have not yet
// issued a publishable key. Never select a secret or service-role key.
const publishable = rows.find((row) => row.type === 'publishable' && String(row.api_key ?? '').startsWith('sb_publishable_'))?.api_key
  ?? rows.find((row) => String(row.name ?? row.key_name ?? '').toLowerCase() === 'anon' && row.type === 'legacy')?.api_key

if (!publishable) throw new Error('QA_PUBLISHABLE_KEY_UNAVAILABLE')

const env = {
  ...process.env,
  VITE_SUPABASE_URL: qaUrl,
  VITE_SUPABASE_ANON_KEY: publishable,
  VITE_RELEASE_ENV: 'QA',
  VITE_RELEASE_CHANNEL: 'beta',
  VITE_RELEASE_VERSION: version.appVersion,
  VITE_NATIVE_VERSION: version.nativeVersion,
  INVEN3_VERSION_CODE: String(version.versionCode),
  VITE_BUILD_TYPE: 'BETA',
}
delete env.SUPABASE_SERVICE_ROLE_KEY
delete env.VITE_SUPABASE_SERVICE_ROLE_KEY
delete env.SERVICE_ROLE_KEY

run('npm', ['run', 'build:qa'], { env })
run('npx', ['cap', 'sync', 'android'], { env })
run(process.platform === 'win32' ? 'gradlew.bat' : './gradlew', ['assembleDebug', '--no-daemon', `-PINVEN3_VERSION_CODE=${version.versionCode}`, `-PINVEN3_VERSION_NAME=${version.nativeVersion}`], { cwd: resolve('android'), env })

const apk = resolve('android/app/build/outputs/apk/debug/app-debug.apk')
if (!fs.existsSync(apk)) throw new Error('QA_APK_MISSING')
const artifacts = resolve('artifacts')
fs.mkdirSync(artifacts, { recursive: true })
const namedApk = resolve(artifacts, `INVEN3-QA-native-v${version.nativeVersion}-app-v${version.appVersion}.apk`)
fs.copyFileSync(apk, namedApk)
const bytes = fs.statSync(namedApk).size
const sha256 = crypto.createHash('sha256').update(fs.readFileSync(namedApk)).digest('hex')
const commit = execFileSync('git', ['rev-parse', 'HEAD'], { encoding: 'utf8', windowsHide: true }).trim()
fs.writeFileSync(resolve(artifacts, `INVEN3-QA-native-v${version.nativeVersion}-app-v${version.appVersion}.manifest.json`), `${JSON.stringify({ product: 'INVEN3', appVersion: version.appVersion, nativeVersion: version.nativeVersion, versionCode: version.versionCode, environment: 'QA', channel: 'qa-beta', commit, buildTimestamp: new Date().toISOString(), apk: { path: `artifacts/INVEN3-QA-native-v${version.nativeVersion}-app-v${version.appVersion}.apk`, sha256, sizeBytes: bytes } }, null, 2)}\n`)
console.log(`QA_APK_ARTIFACT ${namedApk}`)
console.log(`QA_APK_SHA256 ${sha256}`)
