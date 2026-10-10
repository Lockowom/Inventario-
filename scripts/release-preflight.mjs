import fs from 'node:fs'
import path from 'node:path'
import process from 'node:process'

const root = process.cwd()
const policy = JSON.parse(fs.readFileSync(path.join(root, 'release-policy.json'), 'utf8'))
const args = new Set(process.argv.slice(2))
const staticOnly = args.has('--static')
const deferIos = args.has('--defer-ios')

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
if (!gradle.includes(`?: "${policy.native.androidBaseVersionCode}"`)) fail(171, 'Android base versionCode is not aligned with release policy.')
if (!gradle.includes(`?: "${policy.native.androidVersionName}"`)) fail(172, 'Android base versionName is not aligned with release policy.')

const androidManifest = read('android/app/src/main/AndroidManifest.xml')
if (androidManifest.includes('\\n')) fail(176, 'Android manifest contains escaped line breaks and is not valid release XML.')
if (!androidManifest.includes('<manifest') || !androidManifest.includes('</manifest>')) fail(176, 'Android manifest structure is incomplete.')
if (!androidManifest.includes('android.permission.CAMERA')) fail(173, 'Android camera permission required by barcode scanner is missing.')
if (!androidManifest.includes('android:allowBackup="false"')) fail(174, 'Android release must disable application backup.')
if (!androidManifest.includes('android:usesCleartextTraffic="false"')) fail(175, 'Android release must reject cleartext traffic.')

if (!deferIos) {
  const xcode = read('ios/App/App.xcodeproj/project.pbxproj')
  if (!xcode.includes(`MARKETING_VERSION = ${policy.native.iosMarketingVersion};`)) fail(18, 'iOS MARKETING_VERSION is not aligned with release policy.')
  if (!xcode.includes(`CURRENT_PROJECT_VERSION = ${policy.native.iosBaseBuildNumber};`)) fail(181, 'iOS base build number is not aligned with release policy.')

  const iosInfoPlist = read('ios/App/App/Info.plist')
  if (!iosInfoPlist.includes('<key>NSCameraUsageDescription</key>')) fail(182, 'iOS camera usage description is missing.')
  if (!iosInfoPlist.includes('<string>arm64</string>') || iosInfoPlist.includes('<string>armv7</string>')) {
    fail(184, 'iOS required device capability must target arm64.')
  }

  const iosPodfile = read('ios/App/Podfile')
  if (!iosPodfile.includes("platform :ios, '15.5'")) fail(183, 'iOS deployment target must remain at least 15.5 for barcode scanning.')
}

pass(`static release policy ${policy.releaseVersion}; production locked`)
if (deferIos) pass('iOS checks deferred until the final development stage')

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
