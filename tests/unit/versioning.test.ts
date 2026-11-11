import { execFileSync } from 'node:child_process'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'

const script = path.resolve(process.cwd(), 'scripts/versioning.mjs')
const dirs: string[] = []

function fixture(version: string, versionCode = 1) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'inven3-version-'))
  dirs.push(dir)
  const file = path.join(dir, 'version.json')
  fs.writeFileSync(file, `${JSON.stringify({ version, versionCode })}\n`)
  return file
}

function run(command: 'show' | 'validate' | 'bump', file: string) {
  return execFileSync(process.execPath, [script, command, '--file', file], { encoding: 'utf8' })
}

afterEach(() => { for (const dir of dirs.splice(0)) fs.rmSync(dir, { recursive: true, force: true }) })

describe('versionado canónico INVEN3', () => {
  it.each([
    ['0.0.00.01', '0.0.00.02'],
    ['0.0.00.09', '0.0.00.10'],
    ['0.0.00.99', '0.0.01.00'],
  ])('increments %s to %s without reusing a code', (current, next) => {
    const file = fixture(current, 1)
    run('bump', file)
    expect(JSON.parse(fs.readFileSync(file, 'utf8'))).toEqual({ version: next, versionCode: 2 })
  })

  it('shows and validates the canonical initial release', () => {
    const file = fixture('0.0.00.01')
    expect(run('show', file)).toContain('Version: 0.0.00.01')
    expect(run('validate', file)).toContain('VERSION_CONFIG_VALID')
  })
})
