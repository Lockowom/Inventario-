import { execFileSync } from 'node:child_process'
import crypto from 'node:crypto'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { afterEach, describe, expect, test } from 'vitest'

const script = path.resolve(process.cwd(), 'scripts/release-candidate-verify.mjs')
const dirs: string[] = []

function tmp() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'inven3-f10a-'))
  dirs.push(dir)
  return dir
}

function writeJson(file: string, value: unknown) {
  fs.mkdirSync(path.dirname(file), { recursive: true })
  fs.writeFileSync(file, JSON.stringify(value, null, 2))
}

function fixture(overrides: Record<string, unknown> = {}) {
  const dir = tmp()
  writeJson(path.join(dir, 'release-policy.json'), {
    schemaVersion: 1,
    product: 'INVEN3',
    releaseVersion: '1.0.0',
    defaultEnvironment: 'qa',
    defaultChannel: 'beta',
    qaSupabaseProjectRef: 'uazunvlxlszdyweddxtb',
    productionLocked: true,
    native: {
      androidVersionName: '1.0.0',
      androidBaseVersionCode: 10000,
      iosMarketingVersion: '1.0.0',
      iosBaseBuildNumber: 10000,
    },
  })
  const artifact = path.join(dir, 'candidate.bin')
  fs.writeFileSync(artifact, Buffer.from('candidate'))
  const webHash = crypto.createHash('sha256').update('web').digest('hex')
  const manifest = {
    schemaVersion: 1,
    product: 'INVEN3',
    version: '1.0.0',
    environment: 'qa',
    channel: 'beta',
    build: 'deadbeef.42',
    commit: 'deadbeefdeadbeefdeadbeefdeadbeefdeadbeef',
    productionLocked: true,
    native: {
      androidVersionName: '1.0.0',
      androidBaseVersionCode: 10000,
      iosMarketingVersion: '1.0.0',
      iosBaseBuildNumber: 10000,
      effectiveBuildNumber: 10042,
    },
    webBundle: {
      fileCount: 1,
      aggregateSha256: webHash,
      files: [{ path: 'index.html', sha256: webHash, bytes: 3 }],
    },
    ...overrides,
  }
  writeJson(path.join(dir, 'artifacts/release/INVEN3-release-manifest.json'), manifest)
  return { dir, artifact }
}

function run(dir: string, artifact: string, env: Record<string,string> = {}) {
  try {
    const stdout = execFileSync(process.execPath, [
      script,
      '--platform','android',
      '--artifact',artifact,
    ], {
      cwd: dir,
      env: { ...process.env, GITHUB_SHA: 'deadbeefdeadbeefdeadbeefdeadbeefdeadbeef', ...env },
      encoding: 'utf8',
      stdio: ['ignore','pipe','pipe'],
    })
    return { ok: true, stdout, stderr: '', status: 0 }
  } catch (error) {
    const e = error as { stdout?: string | Buffer; stderr?: string | Buffer; status?: number }
    return { ok: false, stdout: String(e.stdout ?? ''), stderr: String(e.stderr ?? ''), status: e.status ?? -1 }
  }
}

afterEach(() => {
  for (const dir of dirs.splice(0)) fs.rmSync(dir, { recursive: true, force: true })
})

describe('F10A release candidate verifier', () => {
  test('accepts QA/BETA locked candidate and emits evidence', () => {
    const { dir, artifact } = fixture()
    const result = run(dir, artifact)
    expect(result.ok).toBe(true)
    expect(result.stdout).toContain('READY_FOR_BETA_SMOKE')
    const evidence = JSON.parse(fs.readFileSync(path.join(dir,'artifacts/release/INVEN3-android-candidate-evidence.json'),'utf8'))
    expect(evidence.status).toBe('READY_FOR_BETA_SMOKE')
    expect(evidence.nativeBuildNumber).toBe(10042)
    expect(evidence.artifacts).toHaveLength(1)
  })

  test('rejects production manifest', () => {
    const { dir, artifact } = fixture({ environment: 'production' })
    const result = run(dir, artifact)
    expect(result.ok).toBe(false)
    expect(result.status).toBe(47)
  })

  test('rejects missing effective native build number', () => {
    const { dir, artifact } = fixture({ native: { effectiveBuildNumber: null } })
    const result = run(dir, artifact)
    expect(result.ok).toBe(false)
    expect(result.status).toBe(50)
  })

  test('rejects commit mismatch', () => {
    const { dir, artifact } = fixture({ commit: 'aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa' })
    const result = run(dir, artifact)
    expect(result.ok).toBe(false)
    expect(result.status).toBe(52)
  })
})
