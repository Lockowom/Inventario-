import { execFileSync } from 'node:child_process'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { afterEach, describe, expect, test } from 'vitest'

const script = path.resolve(process.cwd(), 'scripts/release-manifest.mjs')
const dirs: string[] = []

function fixture() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'inven3-release-manifest-'))
  dirs.push(dir)
  fs.mkdirSync(path.join(dir, 'dist'), { recursive: true })
  fs.writeFileSync(path.join(dir, 'dist/index.html'), '<html>qa</html>')
  fs.writeFileSync(path.join(dir, 'release-policy.json'), JSON.stringify({
    product: 'INVEN3',
    releaseVersion: '1.0.0',
    defaultEnvironment: 'qa',
    defaultChannel: 'beta',
    productionLocked: true,
    native: {
      androidVersionName: '1.0.0',
      androidBaseVersionCode: 10000,
      iosMarketingVersion: '1.0.0',
      iosBaseBuildNumber: 10000,
    },
  }))
  return dir
}

function run(dir: string, env: Record<string, string>) {
  try {
    const stdout = execFileSync(process.execPath, [script], {
      cwd: dir,
      env: {
        ...process.env,
        VITE_APP_BUILD: 'candidate.42',
        INVEN3_NATIVE_BUILD_NUMBER: '10042',
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

describe('release manifest candidate identity', () => {
  test('uses the exact candidate head SHA before the pull request merge SHA', () => {
    const dir = fixture()
    const candidateSha = 'c'.repeat(40)
    const mergeSha = 'd'.repeat(40)
    const result = run(dir, {
      INVEN3_CANDIDATE_SHA: candidateSha,
      GITHUB_SHA: mergeSha,
    })
    expect(result.ok).toBe(true)
    const manifest = JSON.parse(fs.readFileSync(
      path.join(dir, 'artifacts/release/INVEN3-release-manifest.json'),
      'utf8',
    ))
    expect(manifest.commit).toBe(candidateSha)
    expect(manifest.commit).not.toBe(mergeSha)
    expect(manifest.native.effectiveBuildNumber).toBe(10042)
  })

  test('rejects an abbreviated explicit candidate SHA', () => {
    const dir = fixture()
    const result = run(dir, { INVEN3_CANDIDATE_SHA: 'deadbeef' })
    expect(result.ok).toBe(false)
    expect(result.stderr).toContain('full 40-character candidate SHA')
  })
})
