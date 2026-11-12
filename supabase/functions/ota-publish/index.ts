import '@supabase/functions-js/edge-runtime.d.ts'
import { withSupabase } from '@supabase/server'

const sha256 = /^[a-f0-9]{64}$/i
const commitSha = /^[a-f0-9]{40}$/i
const qaVersion = /^\d+\.\d+\.\d{2}\.\d{2}$/
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
    const nativeVersionCode = typeof body.minVersionCode === 'number' && Number.isSafeInteger(body.minVersionCode) ? body.minVersionCode : 0
    const entrypoint = typeof body.entrypoint === 'string' ? body.entrypoint.trim() : 'index.html'
    const url = typeof body.url === 'string' ? body.url.trim() : ''
    const checksum = typeof body.sha256 === 'string' ? body.sha256.trim().toLowerCase() : ''
    const commit = typeof body.commitSha === 'string' ? body.commitSha.trim().toLowerCase() : ''
    const size = typeof body.sizeBytes === 'number' ? body.sizeBytes : 0
    // Field names are safe to return to the CI-only publisher and make an
    // immutable release registration diagnosable without logging its token.
    const invalidFields = [
      !qaVersion.test(version) && 'version',
      !qaVersion.test(nativeVersion) && 'minNativeVersion',
      nativeVersionCode < 1 && 'minVersionCode',
      entrypoint !== 'index.html' && 'entrypoint',
      !url.startsWith(releasePrefix) && 'url',
      !sha256.test(checksum) && 'sha256',
      !commitSha.test(commit) && 'commitSha',
      (!Number.isSafeInteger(size) || size < 1) && 'sizeBytes',
    ].filter((field): field is string => Boolean(field))
    if (invalidFields.length > 0) return deny(400, `Invalid immutable QA OTA manifest: ${invalidFields.join(',')}.`)
    const inserted = await ctx.supabaseAdmin.from('ota_bundles').insert({ channel_name: 'qa-beta', version, min_native_version: nativeVersion, min_native_version_code: nativeVersionCode, entrypoint, release_url: url, sha256: checksum, size_bytes: size, published_commit_sha: commit }).select('id, channel_name, version, sha256, published_at').single()
    if (inserted.error) {
      const existing = await ctx.supabaseAdmin.from('ota_bundles').select('id, channel_name, version, sha256, published_at').eq('channel_name', 'qa-beta').eq('version', version).maybeSingle()
      if (!existing.error && existing.data?.sha256 === checksum) return Response.json({ bundle: existing.data, idempotent: true })
      console.error('ota-publish rejected immutable release', { version, error: inserted.error.message })
      return deny(409, 'OTA version already exists with a different immutable bundle.')
    }
    return Response.json({ bundle: inserted.data, idempotent: false }, { status: 201 })
  }),
}
