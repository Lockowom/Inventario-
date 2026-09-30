import fs from 'node:fs'
import path from 'node:path'
import { describe, expect, test } from 'vitest'

const workflowPath = path.resolve(process.cwd(), '.github/workflows/f10a-github-dual-platform.yml')

function workflow() {
  return fs.readFileSync(workflowPath, 'utf8')
}

describe('F10A GitHub workflow contract', () => {
  test('runs secretless static validation before the runtime QA build', () => {
    const yaml = workflow()
    expect(yaml).toContain('static-validation:')
    expect(yaml).toContain('name: Validate F10A code without runtime secrets')
    expect(yaml).toContain('run: npm run release:preflight:static')
    expect(yaml).toContain('needs: static-validation')
  })

  test('keeps the QA anon key out of global workflow env', () => {
    const yaml = workflow()
    const envStart = yaml.indexOf('\nenv:')
    const jobsStart = yaml.indexOf('\njobs:')
    const globalEnv = yaml.slice(envStart, jobsStart)
    expect(globalEnv).not.toContain('INVEN3_QA_ANON_KEY')
    expect(yaml).toContain('VITE_SUPABASE_ANON_KEY: ${{ secrets.INVEN3_QA_ANON_KEY }}')
  })

  test('gates Android and iOS behind the runtime QA bundle', () => {
    const yaml = workflow()
    expect(yaml).toContain('android:\n    name: Android QA/BETA candidate\n    needs: prepare-web')
    expect(yaml).toContain('ios:\n    name: iOS QA/BETA candidate\n    needs: prepare-web')
  })

  test('does not duplicate expensive static checks inside prepare-web', () => {
    const yaml = workflow()
    const prepareStart = yaml.indexOf('  prepare-web:')
    const androidStart = yaml.indexOf('\n  android:')
    const prepare = yaml.slice(prepareStart, androidStart)
    expect(prepare).toContain('run: npm run release:preflight')
    expect(prepare).toContain('run: npm run build')
    expect(prepare).not.toContain('run: npm run typecheck')
    expect(prepare).not.toContain('run: npm run lint')
    expect(prepare).not.toContain('run: npm run test')
    expect(prepare).not.toContain('run: npm audit --omit=dev')
  })
})
