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
    expect(updates).toContain('PENDING_ADMIN_ASSIGNMENT')
    expect(updates).not.toContain('setChannel')
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
