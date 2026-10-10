import fs from 'node:fs'
import path from 'node:path'
import { describe, expect, test } from 'vitest'

const workflowPath = path.resolve(process.cwd(), '.github/workflows/f10a-github-dual-platform.yml')

function workflow() {
  return fs.readFileSync(workflowPath, 'utf8').replace(/\r\n/g, '\n')
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
    const staticStart = yaml.indexOf('  static-validation:')
    const prepareStart = yaml.indexOf('  prepare-web:')
    const androidStart = yaml.indexOf('\n  android:')
    const staticGate = yaml.slice(staticStart, prepareStart)
    const prepare = yaml.slice(prepareStart, androidStart)

    expect(staticGate).toContain('run: npm run release:preflight:static')
    expect(staticGate).toContain('run: npm run typecheck')
    expect(staticGate).toContain('run: npm run lint')
    expect(staticGate).toContain('run: npm run test')
    expect(staticGate).toContain('run: npm audit --omit=dev')

    expect(prepare).toContain('run: npm run release:preflight')
    expect(prepare).toContain('run: npm run build')
    expect(prepare).not.toContain('run: npm run typecheck')
    expect(prepare).not.toContain('run: npm run lint')
    expect(prepare).not.toContain('run: npm run test')
    expect(prepare).not.toContain('run: npm audit --omit=dev')
  })

  test('allows secretless Vitest startup while keeping QA builds fail-closed', () => {
    const config = fs.readFileSync(path.resolve(process.cwd(), 'vite.config.ts'), 'utf8').replace(/\r\n/g, '\n')
    expect(config).toContain("const isTestMode = mode === 'test'")
    expect(config).toContain("if (releaseEnvironment === 'qa' && !isTestMode)")
    expect(config).toContain('QA release build requires Supabase URL and public anon/publishable key.')
  })

  test('keeps one canonical F10A candidate workflow', () => {
    expect(fs.existsSync(path.resolve(process.cwd(), '.github/workflows/f10a-github-dual-platform.yml'))).toBe(true)
    expect(fs.existsSync(path.resolve(process.cwd(), '.github/workflows/f10a-release-candidate.yml'))).toBe(false)
  })

  test('keeps development CI active while deferring iOS certification to manual final-stage execution', () => {
    const ci = fs.readFileSync(path.resolve(process.cwd(), '.github/workflows/ci.yml'), 'utf8').replace(/\r\n/g, '\n')
    const pushStart = ci.indexOf('  push:')
    const pushBlock = ci.slice(pushStart, ci.indexOf('\n\n', pushStart))
    expect(pushBlock).not.toContain('feature/**')
    expect(pushBlock).not.toContain('fix/**')
    expect(pushBlock).toContain('release/**')
    expect(ci).not.toContain('npx cap sync ios')

    for (const file of [
      '.github/workflows/ios-certification.yml',
      '.github/workflows/ios-virtual-certification.yml',
    ]) {
      const yaml = fs.readFileSync(path.resolve(process.cwd(), file), 'utf8').replace(/\r\n/g, '\n')
      expect(yaml).toContain('workflow_dispatch:')
      expect(yaml).not.toContain('pull_request:')
      expect(yaml).not.toContain('  push:')
    }
  })
})
