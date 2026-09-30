import { execFileSync } from 'node:child_process'
import path from 'node:path'
import { describe, expect, test } from 'vitest'

const root = process.cwd()
const script = path.join(root, 'scripts', 'release-preflight.mjs')
const qaUrl = 'https://uazunvlxlszdyweddxtb.supabase.co'
const qaKey = 'sb_publishable_test_only_not_a_real_secret'

function run(extraEnv: Record<string, string | undefined> = {}, args: string[] = []) {
  const env: NodeJS.ProcessEnv = {
    ...process.env,
    VITE_RELEASE_ENV: 'qa',
    VITE_RELEASE_CHANNEL: 'beta',
    VITE_RELEASE_VERSION: '1.0.0',
    VITE_SUPABASE_URL: qaUrl,
    VITE_SUPABASE_ANON_KEY: qaKey,
    ...extraEnv,
  }

  for (const [key, value] of Object.entries(env)) {
    if (value === undefined) delete env[key]
  }

  try {
    const stdout = execFileSync(process.execPath, [script, ...args], {
      cwd: root,
      env,
      encoding: 'utf8',
      stdio: ['ignore', 'pipe', 'pipe'],
    })
    return { ok: true, stdout, stderr: '', status: 0 }
  } catch (error) {
    const failure = error as {
      stdout?: string | Buffer
      stderr?: string | Buffer
      status?: number
    }
    return {
      ok: false,
      stdout: String(failure.stdout ?? ''),
      stderr: String(failure.stderr ?? ''),
      status: failure.status ?? -1,
    }
  }
}

describe('F10A release preflight fail-closed guard', () => {
  test('static policy remains production locked', () => {
    const result = run({}, ['--static'])
    expect(result.ok).toBe(true)
    expect(result.stdout).toContain('production locked')
  })

  test('accepts the authorized QA/BETA environment', () => {
    const result = run()
    expect(result.ok).toBe(true)
    expect(result.stdout).toContain('environment=qa channel=beta version=1.0.0')
    expect(result.stdout).toContain('production promotion is locked')
  })

  test('rejects production environment while F10A is locked', () => {
    const result = run({ VITE_RELEASE_ENV: 'production' })
    expect(result.ok).toBe(false)
    expect(result.status).toBe(30)
    expect(result.stderr).toContain('PRODUCTION RELEASE BLOCKED')
  })

  test('rejects production channel while F10A is locked', () => {
    const result = run({ VITE_RELEASE_CHANNEL: 'production' })
    expect(result.ok).toBe(false)
    expect(result.status).toBe(30)
    expect(result.stderr).toContain('PRODUCTION RELEASE BLOCKED')
  })

  test('rejects a remote Supabase backend outside INVEN3-QA', () => {
    const result = run({ VITE_SUPABASE_URL: 'https://aaaaaaaaaaaaaaaaaaaa.supabase.co' })
    expect(result.ok).toBe(false)
    expect(result.status).toBe(33)
    expect(result.stderr).toContain('outside INVEN3-QA')
  })

  test('rejects a QA candidate without a public Supabase key', () => {
    const result = run({ VITE_SUPABASE_ANON_KEY: undefined })
    expect(result.ok).toBe(false)
    expect(result.status).toBe(32)
    expect(result.stderr).toContain('VITE_SUPABASE_ANON_KEY is required')
  })

  test('rejects a mismatched release version', () => {
    const result = run({ VITE_RELEASE_VERSION: '1.0.1' })
    expect(result.ok).toBe(false)
    expect(result.status).toBe(22)
    expect(result.stderr).toContain('runtime release version')
  })
})
