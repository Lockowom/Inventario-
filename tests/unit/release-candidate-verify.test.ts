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

function fixture(
  overrides: Record<string, unknown> = {},
  platform: 'android' | 'ios' = 'android',
) {
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
  const apk = path.join(dir, 'candidate.apk')
  const aab = path.join(dir, 'candidate.aab')
  fs.writeFileSync(apk, Buffer.from('apk candidate'))
  fs.writeFileSync(aab, Buffer.from('aab candidate'))
  const fileHash = crypto.createHash('sha256').update('web').digest('hex')
  const webHash = crypto.createHash('sha256')
    .update(`index.html:${fileHash}:3`)
    .digest('hex')
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
      files: [{ path: 'index.html', sha256: fileHash, bytes: 3 }],
    },
    ...overrides,
  }
  writeJson(path.join(dir, 'artifacts/release/INVEN3-release-manifest.json'), manifest)
  writeJson(path.join(dir, 'artifacts/release/native-web.json'), {
    schemaVersion: 1,
    product: 'INVEN3',
    gate: 'F10A_NATIVE_WEB_PARITY',
    status: 'PASS',
    platform,
    version: '1.0.0',
    environment: 'qa',
    channel: 'beta',
    build: manifest.build,
    commit: manifest.commit,
    productionLocked: true,
    webBundleSha256: webHash,
    verifiedFileCount: 1,
    nativeFileCount: 1,
    nativeDirectory: platform === 'android'
      ? 'android/app/src/main/assets/public'
      : 'ios/App/App/public',
    generatedAt: '2026-09-30T12:00:00.000Z',
  })
  return { dir, artifacts: [apk, aab] }
}

function run(
  dir: string,
  artifacts: string[],
  platform = 'android',
  env: Record<string, string> = {},
  nativeWebEvidence = 'artifacts/release/native-web.json',
) {
  const artifactArgs = artifacts.flatMap((artifact) => ['--artifact', artifact])
  try {
    const stdout = execFileSync(process.execPath, [
      script,
      '--platform', platform,
      '--native-web-evidence', nativeWebEvidence,
      ...artifactArgs,
    ], {
      cwd: dir,
      env: {
        ...process.env,
        INVEN3_CANDIDATE_SHA: env.INVEN3_CANDIDATE_SHA ?? 'deadbeefdeadbeefdeadbeefdeadbeefdeadbeef',
        GITHUB_SHA: 'deadbeefdeadbeefdeadbeefdeadbeefdeadbeef',
        ...env,
      },
      encoding: 'utf8',
      stdio: ['ignore', 'pipe', 'pipe'],
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
  test('accepts QA/BETA locked Android candidate and emits evidence', () => {
    const { dir, artifacts } = fixture()
    const result = run(dir, artifacts)
    expect(result.ok).toBe(true)
    expect(result.stdout).toContain('READY_FOR_BETA_SMOKE')
    const evidence = JSON.parse(fs.readFileSync(path.join(dir, 'artifacts/release/INVEN3-android-candidate-evidence.json'), 'utf8'))
    expect(evidence.status).toBe('READY_FOR_BETA_SMOKE')
    expect(evidence.nativeBuildNumber).toBe(10042)
    expect(evidence.nativeWebVerification.nativeFileCount).toBe(1)
    expect(evidence.artifacts).toHaveLength(2)
  })

  test('accepts an IPA-only iOS candidate', () => {
    const { dir } = fixture({}, 'ios')
    const ipa = path.join(dir, 'candidate.ipa')
    fs.writeFileSync(ipa, Buffer.from('ipa candidate'))
    const result = run(dir, [ipa], 'ios')
    expect(result.ok).toBe(true)
    const evidence = JSON.parse(fs.readFileSync(path.join(dir, 'artifacts/release/INVEN3-ios-candidate-evidence.json'), 'utf8'))
    expect(evidence.platform).toBe('ios')
    expect(evidence.artifacts[0].path).toBe('candidate.ipa')
  })

  test('rejects candidate without native web parity evidence', () => {
    const { dir, artifacts } = fixture()
    fs.rmSync(path.join(dir, 'artifacts/release/native-web.json'))
    const result = run(dir, artifacts)
    expect(result.ok).toBe(false)
    expect(result.status).toBe(61)
  })

  test('rejects native web evidence for another platform', () => {
    const { dir, artifacts } = fixture({}, 'ios')
    const result = run(dir, artifacts)
    expect(result.ok).toBe(false)
    expect(result.status).toBe(62)
  })

  test('rejects native web evidence whose exact native file count differs', () => {
    const { dir, artifacts } = fixture()
    const evidencePath = path.join(dir, 'artifacts/release/native-web.json')
    const evidence = JSON.parse(fs.readFileSync(evidencePath, 'utf8'))
    evidence.nativeFileCount = 2
    fs.writeFileSync(evidencePath, JSON.stringify(evidence))
    const result = run(dir, artifacts)
    expect(result.ok).toBe(false)
    expect(result.status).toBe(63)
    expect(result.stderr).toContain('exact file set count mismatch')
  })

  test('rejects an inconsistent manifest aggregate hash', () => {
    const { dir, artifacts } = fixture({ webBundle: {
      fileCount: 1,
      aggregateSha256: 'f'.repeat(64),
      files: [{ path: 'index.html', sha256: 'e'.repeat(64), bytes: 3 }],
    } })
    const result = run(dir, artifacts)
    expect(result.ok).toBe(false)
    expect(result.status).toBe(64)
  })

  test('rejects build identity with non-numeric suffix', () => {
    const { dir, artifacts } = fixture({ build: 'deadbeef.not-a-run' })
    const result = run(dir, artifacts)
    expect(result.ok).toBe(false)
    expect(result.status).toBe(53)
    expect(result.stderr).toContain('build identity is not bound')
  })

  test('rejects an artifact outside repository root', () => {
    const { dir, artifacts } = fixture()
    const external = path.join(os.tmpdir(), `inven3-external-${Date.now()}.aab`)
    fs.writeFileSync(external, Buffer.from('external aab'))
    try {
      const result = run(dir, [artifacts[0]!, external])
      expect(result.ok).toBe(false)
      expect(result.status).toBe(65)
      expect(result.stderr).toContain('must stay inside repository root')
    } finally {
      fs.rmSync(external, { force: true })
    }
  })

  test('rejects native web evidence outside repository root', () => {
    const { dir, artifacts } = fixture()
    const internal = path.join(dir, 'artifacts/release/native-web.json')
    const external = path.join(os.tmpdir(), `inven3-native-evidence-${Date.now()}.json`)
    fs.copyFileSync(internal, external)
    try {
      const result = run(dir, artifacts, 'android', {}, external)
      expect(result.ok).toBe(false)
      expect(result.status).toBe(65)
      expect(result.stderr).toContain('must stay inside repository root')
    } finally {
      fs.rmSync(external, { force: true })
    }
  })

  test('rejects Android candidate without an AAB', () => {
    const { dir, artifacts } = fixture()
    const result = run(dir, [artifacts[0]!])
    expect(result.ok).toBe(false)
    expect(result.status).toBe(58)
  })

  test('rejects an unexpected iOS artifact type', () => {
    const { dir, artifacts } = fixture({}, 'ios')
    const result = run(dir, [artifacts[0]!], 'ios')
    expect(result.ok).toBe(false)
    expect(result.status).toBe(59)
  })

  test('rejects production manifest', () => {
    const { dir, artifacts } = fixture({ environment: 'production' })
    const result = run(dir, artifacts)
    expect(result.ok).toBe(false)
    expect(result.status).toBe(47)
  })

  test('rejects missing effective native build number', () => {
    const { dir, artifacts } = fixture({ native: { effectiveBuildNumber: null } })
    const result = run(dir, artifacts)
    expect(result.ok).toBe(false)
    expect(result.status).toBe(50)
  })

  test('uses the explicit candidate SHA instead of the pull request merge SHA', () => {
    const candidateSha = 'c'.repeat(40)
    const { dir, artifacts } = fixture({ commit: candidateSha, build: 'cccccccc.42' })
    const result = run(dir, artifacts, 'android', { INVEN3_CANDIDATE_SHA: candidateSha })
    expect(result.ok).toBe(true)
  })

  test('rejects commit mismatch', () => {
    const { dir, artifacts } = fixture({ commit: 'aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa' })
    const result = run(dir, artifacts)
    expect(result.ok).toBe(false)
    expect(result.status).toBe(52)
  })
})
