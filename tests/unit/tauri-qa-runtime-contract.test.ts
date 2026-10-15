import fs from 'node:fs'
import path from 'node:path'
import { describe, expect, it } from 'vitest'
import { displayReleaseChannel, resolveReleaseMetadata } from '../../src/config/release-metadata'

const root = process.cwd()

describe('WIN-02.1 Tauri QA runtime contract', () => {
  it('runs the Windows Tauri foundation through Vite QA mode for both development and build', () => {
    const packageJson = JSON.parse(fs.readFileSync(path.join(root, 'package.json'), 'utf8')) as { scripts: Record<string, string> }
    const tauriConfig = JSON.parse(fs.readFileSync(path.join(root, 'src-tauri/tauri.conf.json'), 'utf8')) as {
      build: { beforeDevCommand: string; beforeBuildCommand: string }
    }

    expect(packageJson.scripts['dev:qa']).toBe('vite --mode qa')
    expect(packageJson.scripts['build:qa']).toBe('tsc -b && vite build --mode qa')
    expect(packageJson.scripts['tauri:dev:qa']).toBe('tauri dev')
    expect(packageJson.scripts['tauri:build:qa']).toBe('tauri build')
    expect(tauriConfig.build.beforeDevCommand).toContain('npm run dev:qa')
    expect(tauriConfig.build.beforeBuildCommand).toBe('npm run build:qa')
    expect(JSON.stringify(tauriConfig)).not.toContain('.supabase.co')
  })

  it('keeps local QA client configuration out of version control while providing a non-secret template', () => {
    const gitignore = fs.readFileSync(path.join(root, '.gitignore'), 'utf8')
    const template = fs.readFileSync(path.join(root, '.env.qa.example'), 'utf8')

    expect(gitignore).toContain('.env.qa.local')
    expect(gitignore).toContain('!.env.qa.example')
    expect(template).toContain('VITE_SUPABASE_URL=')
    expect(template).toContain('VITE_SUPABASE_ANON_KEY=')
    expect(template).not.toMatch(/service_role\s*=/i)
  })

  it('labels the existing QA beta release identity as QA-BETA without adding a new environment variable', () => {
    const qaMetadata = resolveReleaseMetadata({ environment: 'qa', channel: 'beta', version: '1.0.0' })
    expect(displayReleaseChannel(qaMetadata)).toBe('QA-BETA')
    expect(displayReleaseChannel(resolveReleaseMetadata({ environment: 'local', channel: 'development' }))).toBe('DEVELOPMENT')
  })
})
