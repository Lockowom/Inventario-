import { execFileSync } from 'node:child_process'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { afterEach, describe, expect, test } from 'vitest'

const script = path.resolve(process.cwd(), 'scripts/f10a-smoke-evidence-check.mjs')
const dirs: string[] = []

function temp() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'inven3-smoke-evidence-'))
  dirs.push(dir)
  return dir
}

function record(overrides: Record<string, unknown> = {}) {
  return {
    execution_id: 'smoke-001',
    gate: 'F10A_BETA_SMOKE',
    status: 'PASS',
    platform: 'android',
    candidate_sha: 'a'.repeat(40),
    candidate_evidence_ref: 'INVEN3-android-candidate-evidence.json',
    version: '1.0.0',
    environment: 'qa',
    channel: 'beta',
    production_locked: true,
    native_build_number: 10042,
    app_display_version: '1.0.0-beta+aaaaaaaa.42',
    device_model: 'QA Device',
    os: 'Android',
    os_version: '16',
    started_at: '2026-09-28T12:00:00.000Z',
    finished_at: '2026-09-28T12:10:00.000Z',
    operator: 'QA',
    checks: {
      app_launch: true,
      release_identity_qa_beta: true,
      supabase_configured: true,
      authenticated_runtime: true,
      health_non_blocking: true,
      counting_screen: true,
      my_counts_screen: true,
      synthetic_count_saved: true,
      synthetic_count_confirmed: true,
      scanner_open_cancel_no_autosave: true,
    },
    evidence_refs: ['evidence-1'],
    defects: [],
    notes: 'Synthetic QA smoke.',
    ...overrides,
  }
}

function run(dir: string, value: unknown) {
  const file = path.join(dir, 'evidence.json')
  fs.writeFileSync(file, JSON.stringify(value))
  try {
    const stdout = execFileSync(process.execPath, [script, file], { encoding: 'utf8', stdio: ['ignore','pipe','pipe'] })
    return { ok: true, status: 0, stdout, stderr: '' }
  } catch (error) {
    const e = error as { stdout?: string | Buffer; stderr?: string | Buffer; status?: number }
    return { ok: false, status: e.status ?? -1, stdout: String(e.stdout ?? ''), stderr: String(e.stderr ?? '') }
  }
}

afterEach(() => {
  for (const dir of dirs.splice(0)) fs.rmSync(dir, { recursive: true, force: true })
})

describe('F10A smoke evidence validator', () => {
  test('accepts complete QA/BETA PASS evidence', () => {
    const result = run(temp(), record())
    expect(result.ok).toBe(true)
    expect(result.stdout).toContain('READY_FOR_F10A_CLOSURE')
  })

  test('rejects PASS when a required check is false', () => {
    const value = record()
    ;(value.checks as Record<string, boolean>).synthetic_count_confirmed = false
    const result = run(temp(), value)
    expect(result.ok).toBe(false)
    expect(result.status).toBe(83)
    expect(result.stderr).toContain('PASS_REQUIRES_SYNTHETIC_COUNT_CONFIRMED')
  })

  test('rejects production evidence', () => {
    const result = run(temp(), record({ environment: 'production' }))
    expect(result.ok).toBe(false)
    expect(result.status).toBe(83)
    expect(result.stderr).toContain('INVALID_ENVIRONMENT')
  })

  test('rejects PASS with an open blocking defect', () => {
    const defects = [{
      defect_id:'D1', severity:'BLOCKER', scenario:'count', description:'lost count',
      expected:'persist', observed:'missing', status:'OPEN', evidence:'e1'
    }]
    const result = run(temp(), record({ defects }))
    expect(result.ok).toBe(false)
    expect(result.status).toBe(83)
    expect(result.stderr).toContain('PASS_HAS_OPEN_BLOCKING_DEFECT')
  })
})
