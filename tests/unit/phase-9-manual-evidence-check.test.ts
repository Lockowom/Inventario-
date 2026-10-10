import { execFileSync } from 'node:child_process'
import { mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'

const directories: string[] = []

async function runEvidence(record: Record<string, unknown>): Promise<string> {
  const directory = await mkdtemp(join(tmpdir(), 'inven3-f9b-'))
  directories.push(directory)
  const file = join(directory, 'evidence.json')
  await writeFile(file, JSON.stringify(record), 'utf8')
  return execFileSync(process.execPath, ['scripts/phase-9-manual-evidence-check.mjs', file], { cwd: process.cwd(), encoding: 'utf8' }).trim()
}

function validEvidence(): Record<string, unknown> {
  return {
    execution_id: 'manual-beta-001',
    gate: 'BETA_MANUAL',
    status: 'PASS',
    candidate_sha: '82a92f60f14a9e56014cf4825fafb7bdf7b9582e',
    build_sha: '82a92f60f14a9e56014cf4825fafb7bdf7b9582e',
    app_version: '0.1.0',
    started_at: '2026-09-25T12:00:00.000Z',
    finished_at: '2026-09-25T12:10:00.000Z',
    operator: 'qa operator',
    environment: 'controlled-test',
    evidence_refs: ['internal://evidence/reference'],
    defects: [],
    notes: 'synthetic validator fixture only',
    role: 'CONTADOR',
    scenario: 'offline restart',
    observer: 'qa observer',
  }
}

afterEach(async () => {
  await Promise.all(directories.splice(0).map((directory) => rm(directory, { recursive: true, force: true })))
})

describe('F9B manual evidence validator', () => {
  it('reports a complete synthetic evidence record without certifying it', async () => {
    await expect(runEvidence(validEvidence())).resolves.toBe('EVIDENCE_COMPLETE')
  })

  it('rejects a missing required field', async () => {
    const record = validEvidence()
    delete record.operator
    await expect(runEvidence(record)).resolves.toBe('EVIDENCE_INCOMPLETE')
  })

  it('rejects PASS without evidence references', async () => {
    const record = validEvidence()
    record.evidence_refs = []
    await expect(runEvidence(record)).resolves.toBe('EVIDENCE_INCOMPLETE')
  })

  it('rejects PASS with an open critical defect', async () => {
    const record = validEvidence()
    record.defects = [{ defect_id: 'defect-1', gate: 'BETA_MANUAL', scenario: 'offline restart', severity: 'CRITICAL', description: 'synthetic only', expected: 'no loss', observed: 'synthetic defect', evidence: 'internal://evidence/defect', build_sha: record.build_sha, status: 'OPEN', rerun: 'not-run' }]
    await expect(runEvidence(record)).resolves.toBe('EVIDENCE_INCOMPLETE')
  })

  it('rejects RP evidence without SHA-256', async () => {
    const record = { ...validEvidence(), gate: 'RP_REAL_IMPORT', file_name: 'cut.xlsx', sha256: '', record_count: 1, rp_environment: 'TEST', rows_accepted: 1, rows_rejected: 0 }
    await expect(runEvidence(record)).resolves.toBe('EVIDENCE_INCOMPLETE')
  })
})
