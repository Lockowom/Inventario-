import { spawnSync } from 'node:child_process'
import { existsSync } from 'node:fs'
import { join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { dirname } from 'node:path'

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const isWin = process.platform === 'win32'
const npm = isWin ? 'npm.cmd' : 'npm'
const gradle = isWin ? 'gradlew.bat' : './gradlew'
const adb = process.env.LOCALAPPDATA
  ? join(process.env.LOCALAPPDATA, 'Android', 'Sdk', 'platform-tools', isWin ? 'adb.exe' : 'adb')
  : 'adb'
const apk = join(ROOT, 'android', 'app', 'build', 'outputs', 'apk', 'debug', 'app-debug.apk')

function run(command, args, options = {}) {
  console.log('')
  console.log(`[RUN] ${command} ${args.join(' ')}`)
  const result = spawnSync(command, args, {
    cwd: options.cwd ?? ROOT,
    env: options.env ?? process.env,
    encoding: 'utf8',
    stdio: 'inherit',
    timeout: options.timeout ?? 600000,
  })
  if (result.error) throw result.error
  if (result.status !== 0) throw new Error(`${command} ${args.join(' ')} falló con código ${result.status}`)
}

if (!process.env.VITE_SUPABASE_URL) throw new Error('Falta VITE_SUPABASE_URL en esta PowerShell.')
if (!process.env.VITE_SUPABASE_ANON_KEY) throw new Error('Falta VITE_SUPABASE_ANON_KEY en esta PowerShell.')

const git = spawnSync('git', ['rev-parse', '--short=8', 'HEAD'], { cwd: ROOT, encoding: 'utf8' })
if (git.status !== 0) throw new Error('No fue posible leer HEAD de Git.')
process.env.VITE_APP_VERSION = `f9b-qa-${git.stdout.trim()}`
console.log(`[INFO] Build version: ${process.env.VITE_APP_VERSION}`)

run(npm, ['run', 'certify:f9b:auto-offline'])
run(npm, ['run', 'cap:android'])

const gradleEnv = { ...process.env }
if (isWin && !gradleEnv.GRADLE_USER_HOME) gradleEnv.GRADLE_USER_HOME = 'C:\\GradleCache-INVEN3'
run(gradle, ['assembleDebug', '--no-daemon'], { cwd: join(ROOT, 'android'), env: gradleEnv, timeout: 900000 })

if (!existsSync(apk)) throw new Error(`APK no encontrado: ${apk}`)
run(adb, ['devices'])
run(adb, ['install', '-r', apk], { timeout: 180000 })

console.log('')
console.log('[PASS] APK_FRESH_INSTALLED: datos locales preservados con install -r.')
run(process.execPath, [join(ROOT, 'scripts', 'f9b-android-device-certification.mjs')], { timeout: 900000 })
