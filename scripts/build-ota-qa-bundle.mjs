import { execFileSync } from 'node:child_process'
import crypto from 'node:crypto'
import fs from 'node:fs'
import path from 'node:path'
import process from 'node:process'
import { readVersionConfig } from './versioning.mjs'

const root = process.cwd()
const version = readVersionConfig(path.join(root, 'version.json'))
const artifacts = path.join(root, 'artifacts', 'ota')
const archive = path.join(artifacts, `INVEN3-QA-OTA-v${version.appVersion}.zip`)
const manifest = path.join(artifacts, `INVEN3-QA-OTA-v${version.appVersion}.manifest.json`)

function run(command, args, options = {}) {
  execFileSync(command, args, { cwd: root, stdio: 'inherit', windowsHide: true, ...options })
}

run(process.platform === 'win32' ? 'cmd.exe' : 'npm', process.platform === 'win32'
  ? ['/d', '/s', '/c', 'npm run build:qa']
  : ['run', 'build:qa'])

fs.mkdirSync(artifacts, { recursive: true })
fs.rmSync(archive, { force: true })
// Windows ships bsdtar. Keeping the dist contents at the archive root is
// required by the Capgo entrypoint and is independently verified by SHA-256.
run('tar', ['-a', '-c', '-f', archive, '-C', path.join(root, 'dist'), '.'])
const sizeBytes = fs.statSync(archive).size
const sha256 = crypto.createHash('sha256').update(fs.readFileSync(archive)).digest('hex')
const commitSha = execFileSync('git', ['rev-parse', 'HEAD'], { cwd: root, encoding: 'utf8', windowsHide: true }).trim()
const payload = {
  product: 'INVEN3',
  appVersion: version.appVersion,
  nativeVersion: version.nativeVersion,
  minimumNativeVersion: version.nativeVersion,
  minimumVersionCode: version.versionCode,
  environment: 'QA',
  channel: 'qa-beta',
  entrypoint: 'index.html',
  commitSha,
  createdAt: new Date().toISOString(),
  sha256,
  sizeBytes,
  artifact: path.relative(root, archive).replaceAll('\\', '/'),
}
fs.writeFileSync(manifest, `${JSON.stringify(payload, null, 2)}\n`, 'utf8')
console.log(`OTA_QA_BUNDLE ${payload.artifact}`)
console.log(`OTA_QA_SHA256 ${sha256}`)
