import { execFileSync } from 'node:child_process'
import crypto from 'node:crypto'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { afterEach, describe, expect, test } from 'vitest'

const script = path.resolve(process.cwd(), 'scripts/release-native-web-verify.mjs')
const dirs: string[] = []
const commit = 'a'.repeat(40)

function hash(value: string | Buffer) {
  return crypto.createHash('sha256').update(value).digest('hex')
}

function fixture(platform: 'android' | 'ios' = 'android') {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'inven3-native-web-'))
  dirs.push(dir)
  const nativeDir = platform === 'android'
    ? path.join(dir, 'android/app/src/main/assets/public')
    : path.join(dir, 'ios/App/App/public')
  fs.mkdirSync(path.join(nativeDir, 'assets'), { recursive: true })
  fs.writeFileSync(path.join(nativeDir, 'index.html'), '<html>qa</html>')
  fs.writeFileSync(path.join(nativeDir, 'assets/app.js'), 'console.log("qa")')

  const files = [
    { path: 'assets/app.js', sha256: hash('console.log("qa")'), bytes: 17 },
    { path: 'index.html', sha256: hash('<html>qa</html>'), bytes: 15 },
  ]
  const aggregateSha256 = hash(files.map((file) => `${file.path}:${file.sha256}:${file.bytes}`).join('\n'))

  fs.mkdirSync(path.join(dir, 'artifacts/release'), { recursive: true })
  fs.writeFileSync(path.join(dir, 'release-policy.json'), JSON.stringify({
    product: 'INVEN3',
    releaseVersion: '1.0.0',
    productionLocked: true,
  }))
  fs.writeFileSync(path.join(dir, 'artifacts/release/INVEN3-release-manifest.json'), JSON.stringify({
    schemaVersion: 1,
    product: 'INVEN3',
    version: '1.0.0',
    environment: 'qa',
    channel: 'beta',
    build: 'aaaaaaaa.42',
    commit,
    productionLocked: true,
    webBundle: {
      fileCount: files.length,
      aggregateSha256,
      files,
    },
  }))
  return { dir, nativeDir, aggregateSha256 }
}

function run(dir: string, platform: 'android' | 'ios') {
  try {
    const stdout = execFileSync(process.execPath, [script, '--platform', platform], {
      cwd: dir,
      encoding: 'utf8',
      stdio: ['ignore', 'pipe', 'pipe'],
    })
    return { ok: true, status: 0, stdout, stderr: '' }
  } catch (error) {
    const e = error as { stdout?: string | Buffer; stderr?: string | Buffer; status?: number }
    return {
      ok: false,
      status: e.status ?? -1,
      stdout: String(e.stdout ?? ''),
      stderr: String(e.stderr ?? ''),
    }
  }
}

afterEach(() => {
  for (const dir of dirs.splice(0)) fs.rmSync(dir, { recursive: true, force: true })
})

describe('F10A native web bundle verifier', () => {
  test.each(['android', 'ios'] as const)('accepts the exact certified bundle on %s', (platform) => {
    const { dir, aggregateSha256 } = fixture(platform)
    const result = run(dir, platform)
    expect(result.ok).toBe(true)
    expect(result.stdout).toContain('F10A_NATIVE_WEB_PARITY')
    const evidence = JSON.parse(fs.readFileSync(
      path.join(dir, `artifacts/release/INVEN3-${platform}-native-web-evidence.json`),
      'utf8',
    ))
    expect(evidence.status).toBe('PASS')
    expect(evidence.webBundleSha256).toBe(aggregateSha256)
    expect(evidence.verifiedFileCount).toBe(2)
  })

  test('rejects a native file changed after the canonical manifest', () => {
    const { dir, nativeDir } = fixture('android')
    fs.writeFileSync(path.join(nativeDir, 'index.html'), '<html>tampered</html>')
    const result = run(dir, 'android')
    expect(result.ok).toBe(false)
    expect(result.status).toBe(129)
    expect(result.stderr).toContain('certified web file mismatch')
  })

  test('rejects a certified file missing from the native project', () => {
    const { dir, nativeDir } = fixture('ios')
    fs.rmSync(path.join(nativeDir, 'assets/app.js'))
    const result = run(dir, 'ios')
    expect(result.ok).toBe(false)
    expect(result.status).toBe(128)
    expect(result.stderr).toContain('certified web file missing')
  })

  test('rejects unsafe paths in the release manifest', () => {
    const { dir } = fixture('android')
    const manifestPath = path.join(dir, 'artifacts/release/INVEN3-release-manifest.json')
    const manifest = JSON.parse(fs.readFileSync(manifestPath, 'utf8'))
    manifest.webBundle.files[0].path = '../escape.js'
    fs.writeFileSync(manifestPath, JSON.stringify(manifest))
    const result = run(dir, 'android')
    expect(result.ok).toBe(false)
    expect(result.status).toBe(126)
    expect(result.stderr).toContain('unsafe web path')
  })
})
