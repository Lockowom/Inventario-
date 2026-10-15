import '@supabase/functions-js/edge-runtime.d.ts'
import { withSupabase } from '@supabase/server'

const sha256 = /^[a-f0-9]{64}$/i
const commitSha = /^[a-f0-9]{40}$/i
const qaVersion = /^\d+\.\d+\.\d+-qa\.\d+$/
const releasePrefix = 'https://github.com/Lockowom/Inventario-/releases/download/'

function deny(status: number, error: string) { return Response.json({ error }, { status }) }
function equal(left: string, right: string) {
  if (left.length !== right.length) return false
  let delta = 0
  for (let index = 0; index < left.length; index += 1) delta |= left.charCodeAt(index) ^ right.charCodeAt(index)
  return delta === 0
}

/** CI-only publisher. The deploy token is checked here; it never reaches an app. */
export default {
  fetch: withSupabase({ auth: 'none' }, async (request, ctx) => {
    if (request.method !== 'POST') return deny(405, 'Method not allowed.')
    const expected = Deno.env.get('OTA_PUBLISH_TOKEN')
    const supplied = request.headers.get('x-ota-publish-token') ?? ''
    if (!expected || !equal(supplied, expected)) return deny(401, 'Unauthorized publisher.')
    let body: Record<string, unknown>
    try { body = await request.json() } catch { return deny(400, 'Body must be JSON.') }
    const version = typeof body.version === 'string' ? body.version.trim() : ''
    const nativeVersion = typeof body.minNativeVersion === 'string' ? body.minNativeVersion.trim() : ''
    const url = typeof body.url === 'string' ? body.url.trim() : ''
    const checksum = typeof body.sha256 === 'string' ? body.sha256.trim().toLowerCase() : ''
    const commit = typeof body.commitSha === 'string' ? body.commitSha.trim().toLowerCase() : ''
    const size = typeof body.sizeBytes === 'number' ? body.sizeBytes : 0
    if (!qaVersion.test(version) || !nativeVersion || !url.startsWith(releasePrefix) || !sha256.test(checksum) || !commitSha.test(commit) || !Number.isSafeInteger(size) || size < 1) return deny(400, 'Invalid immutable QA OTA manifest.')
    const inserted = await ctx.supabaseAdmin.from('ota_bundles').insert({ channel_name: 'qa-beta', version, min_native_version: nativeVersion, release_url: url, sha256: checksum, size_bytes: size, published_commit_sha: commit }).select('id, channel_name, version, sha256, published_at').single()
    if (inserted.error) {
      const existing = await ctx.supabaseAdmin.from('ota_bundles').select('id, channel_name, version, sha256, published_at').eq('channel_name', 'qa-beta').eq('version', version).maybeSingle()
      if (!existing.error && existing.data?.sha256 === checksum) return Response.json({ bundle: existing.data, idempotent: true })
      console.error('ota-publish rejected immutable release', { version, error: inserted.error.message })
      return deny(409, 'OTA version already exists with a different immutable bundle.')
    }
    return Response.json({ bundle: inserted.data, idempotent: false }, { status: 201 })
  }),
}
