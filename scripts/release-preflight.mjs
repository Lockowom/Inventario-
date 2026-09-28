import fs from 'node:fs'
import path from 'node:path'
import process from 'node:process'

const root = process.cwd()
const policy = JSON.parse(fs.readFileSync(path.join(root, 'release-policy.json'), 'utf8'))
const args = new Set(process.argv.slice(2))
const staticOnly = args.has('--static')

function fail(code, message) {
  console.error(`[FAIL] ${message}`)
  process.exit(code)
}

function pass(message) {
  console.log(`[PASS] ${message}`)
}

function read(file) {
  return fs.readFileSync(path.join(root, file), 'utf8')
}

if (policy.productionLocked !== true) fail(10, 'F10A requires productionLocked=true until production is explicitly authorized.')
if (!/^\d+\.\d+\.\d+$/.test(policy.releaseVersion)) fail(11, 'releaseVersion must be SemVer x.y.z.')
if (policy.defaultEnvironment !== 'qa') fail(12, 'F10A defaultEnvironment must remain qa.')
if (policy.defaultChannel !== 'beta') fail(13, 'F10A defaultChannel must remain beta.')
if (!/^[a-z0-9]{20}$/.test(policy.qaSupabaseProjectRef)) fail(14, 'QA Supabase project ref is invalid.')

const pkg = JSON.parse(read('package.json'))
if (pkg.version !== policy.releaseVersion) fail(15, `package.json version ${pkg.version} != policy ${policy.releaseVersion}`)

const gradle = read('android/app/build.gradle')
if (!gradle.includes('INVEN3_VERSION_CODE')) fail(16, 'Android versionCode is not release-configurable.')
if (!gradle.includes('INVEN3_VERSION_NAME')) fail(17, 'Android versionName is not release-configurable.')

const xcode = read('ios/App/App.xcodeproj/project.pbxproj')
if (!xcode.includes(`MARKETING_VERSION = ${policy.native.iosMarketingVersion};`)) fail(18, 'iOS MARKETING_VERSION is not aligned with release policy.')

pass(`static release policy ${policy.releaseVersion}; production locked`)

if (staticOnly) process.exit(0)

const environment = (process.env.VITE_RELEASE_ENV || policy.defaultEnvironment).toLowerCase()
const channel = (process.env.VITE_RELEASE_CHANNEL || policy.defaultChannel).toLowerCase()
const runtimeVersion = process.env.VITE_RELEASE_VERSION || policy.releaseVersion
const supabaseUrl = process.env.VITE_SUPABASE_URL || ''
const anonKey = process.env.VITE_SUPABASE_ANON_KEY || ''

if (!['qa', 'production'].includes(environment)) fail(20, `unsupported release environment: ${environment}`)
if (!['beta', 'production'].includes(channel)) fail(21, `unsupported release channel: ${channel}`)
if (runtimeVersion !== policy.releaseVersion) fail(22, `runtime release version ${runtimeVersion} != policy ${policy.releaseVersion}`)

if (policy.productionLocked && (environment === 'production' || channel === 'production')) {
  fail(30, 'PRODUCTION RELEASE BLOCKED: productionLocked=true. This branch may only produce QA/BETA candidates.')
}

if (environment === 'qa') {
  if (!supabaseUrl) fail(31, 'VITE_SUPABASE_URL is required for a QA release candidate.')
  if (!anonKey) fail(32, 'VITE_SUPABASE_ANON_KEY is required for a QA release candidate.')
  if (!supabaseUrl.includes(`${policy.qaSupabaseProjectRef}.supabase.co`)) {
    fail(33, 'QA release candidate refuses a Supabase URL outside INVEN3-QA.')
  }
}

pass(`runtime environment=${environment} channel=${channel} version=${runtimeVersion}`)
pass('production promotion is locked')
