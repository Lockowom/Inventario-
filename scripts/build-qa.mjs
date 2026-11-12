import { execFileSync } from 'node:child_process'
import fs from 'node:fs'
import path from 'node:path'
import process from 'node:process'
import { readVersionConfig } from './versioning.mjs'

const root = process.cwd()
const version = readVersionConfig(path.join(root, 'version.json'))
const gradle = fs.readFileSync(path.join(root, 'android/app/build.gradle'), 'utf8')
if (!gradle.includes("version.json") || !gradle.includes('INVEN3_VERSION_OVERRIDE_MISMATCH')) {
  throw new Error('ANDROID_VERSION_CONTRACT_NOT_CANONICAL')
}
if (!gradle.includes('nativeVersion')) throw new Error('ANDROID_NATIVE_VERSION_NOT_CANONICAL')

for (const envFile of ['.env', '.env.qa', '.env.qa.local']) {
  const file = path.join(root, envFile)
  if (!fs.existsSync(file)) continue
  const configuredVersion = fs.readFileSync(file, 'utf8')
    .split(/\r?\n/)
    .map((line) => line.match(/^\s*VITE_RELEASE_VERSION\s*=\s*(.*?)\s*$/)?.[1])
    .find(Boolean)
  if (configuredVersion && configuredVersion !== version.appVersion) {
    throw new Error(`VERSION_ENV_MISMATCH ${envFile}: ${configuredVersion} != ${version.appVersion}`)
  }
}

const env = {
  ...process.env,
  VITE_RELEASE_ENV: process.env.VITE_RELEASE_ENV || 'qa',
  VITE_RELEASE_CHANNEL: process.env.VITE_RELEASE_CHANNEL || 'beta',
  // The canonical release identity must win over any stale local environment.
  VITE_RELEASE_VERSION: version.appVersion,
  VITE_NATIVE_VERSION: version.nativeVersion,
  INVEN3_VERSION_CODE: String(version.versionCode),
}
execFileSync(process.platform === 'win32' ? 'cmd.exe' : 'npm', process.platform === 'win32'
  ? ['/d', '/s', '/c', 'npm run typecheck && npx vite build --mode qa']
  : ['run', 'typecheck'], { cwd: root, env, stdio: 'inherit' })
if (process.platform !== 'win32') execFileSync('npx', ['vite', 'build', '--mode', 'qa'], { cwd: root, env, stdio: 'inherit' })
console.log(`VERSION_PARITY_WEB_OTA app=${version.appVersion} native=${version.nativeVersion}/${version.versionCode}`)
