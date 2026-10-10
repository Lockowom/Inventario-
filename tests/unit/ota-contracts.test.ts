import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { describe, expect, it } from 'vitest'

const root = resolve(import.meta.dirname, '../..')
const read = (path: string) => readFileSync(resolve(root, path), 'utf8')

describe('OTA security and workflow contracts', () => {
  it('keeps publishing private and updates authenticated', () => {
    const publish = read('supabase/functions/ota-publish/index.ts')
    const updates = read('supabase/functions/ota-updates/index.ts')
    expect(publish).toContain("Deno.env.get('OTA_PUBLISH_TOKEN')")
    expect(publish).toContain("withSupabase({ auth: 'none' }")
    expect(updates).toContain("withSupabase({ auth: 'user' }")
    expect(updates).toContain("const qaChannel = 'qa-beta'")
    expect(updates).toContain('channel_name: deviceChannel')
    expect(updates).not.toContain('setChannel')
    expect(updates).not.toContain('body.channel')
  })

  it('keeps the OTA base Android-only, QA-bound and persistently signed', () => {
    const config = read('capacitor.config.ts')
    const workflow = read('.github/workflows/android-qa-base-ota.yml')
    expect(config).toContain('https://uazunvlxlszdyweddxtb.supabase.co/functions/v1/ota-updates')
    expect(config).toContain("autoUpdate: 'off'")
    expect(config).toContain('allowSetDefaultChannel: false')
    expect(workflow).toContain('INVEN3_QA_KEYSTORE_BASE64')
    expect(workflow).toContain('INVEN3_QA_KEYSTORE_PASSWORD')
    expect(workflow).toContain('INVEN3_QA_KEY_ALIAS')
    expect(workflow).toContain('INVEN3_QA_KEY_PASSWORD')
    expect(workflow).toContain('npx cap sync android')
    expect(workflow).toContain('com.lockowom.inven3')
    expect(workflow).toContain('qa-beta')
    expect(workflow).not.toContain('cap sync ios')
    expect(workflow).not.toContain('macos-')
  })

  it('only allows the qa branch and immutable GitHub-release bundles', () => {
    const workflow = read('.github/workflows/ota-qa-beta.yml')
    const migration = read('supabase/migrations/20261007131147_ota_qa_beta_foundation.sql')
    expect(workflow).toContain('branches: [qa]')
    expect(workflow).toContain('gh release create')
    expect(workflow).toContain('sha256sum')
    expect(migration).toContain("name = 'qa-beta'")
    expect(migration).not.toContain("name = 'production'")
  })
})
