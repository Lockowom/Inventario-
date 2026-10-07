import '@supabase/functions-js/edge-runtime.d.ts'
import { withSupabase } from '@supabase/server'

const deviceIdPattern = /^[A-Za-z0-9._:-]{8,200}$/
function json(status: number, body: Record<string, unknown>) { return Response.json(body, { status }) }

/** Authenticated application check. It never assigns a channel to a device. */
export default {
  fetch: withSupabase({ auth: 'user' }, async (request, ctx) => {
    if (request.method !== 'POST') return json(405, { error: 'Method not allowed.' })
    const actor = await ctx.supabase.auth.getUser()
    if (actor.error || !actor.data.user) return json(401, { error: 'Authentication required.' })
    let body: Record<string, unknown>
    try { body = await request.json() } catch { return json(400, { error: 'Body must be JSON.' }) }
    const deviceId = typeof body.deviceId === 'string' ? body.deviceId.trim() : ''
    const nativeVersion = typeof body.nativeVersion === 'string' ? body.nativeVersion.trim() : ''
    const currentVersion = typeof body.currentBundleVersion === 'string' ? body.currentBundleVersion.trim() : null
    const eventType = typeof body.eventType === 'string' ? body.eventType : 'CHECKED'
    if (!deviceIdPattern.test(deviceId) || !nativeVersion) return json(400, { error: 'Invalid OTA device identity.' })
    if (!['CHECKED', 'DOWNLOADED', 'APPLIED', 'ROLLED_BACK', 'FAILED', 'INCOMPATIBLE'].includes(eventType)) return json(400, { error: 'Unsupported OTA event.' })
    const existing = await ctx.supabaseAdmin.from('ota_devices').select('user_id').eq('device_id', deviceId).maybeSingle()
    if (existing.error) return json(500, { error: 'Unable to resolve OTA device.' })
    if (existing.data && existing.data.user_id !== actor.data.user.id) return json(403, { error: 'Device belongs to another user.' })
    const device = await ctx.supabaseAdmin.from('ota_devices').upsert({ device_id: deviceId, user_id: actor.data.user.id, native_version: nativeVersion, current_bundle_version: currentVersion, last_seen_at: new Date().toISOString(), last_check_at: new Date().toISOString(), last_error_code: eventType === 'FAILED' ? 'CLIENT_REPORTED_FAILURE' : null }, { onConflict: 'device_id' }).select('device_id, channel_name').single()
    if (device.error || !device.data) return json(500, { error: 'Unable to register OTA device.' })
    if (!device.data.channel_name) return json(200, { update: null, enrollment: 'PENDING_ADMIN_ASSIGNMENT' })
    const bundle = await ctx.supabaseAdmin.from('ota_bundles').select('id, version, min_native_version, release_url, sha256, size_bytes').eq('channel_name', device.data.channel_name).is('revoked_at', null).order('published_at', { ascending: false }).limit(1).maybeSingle()
    if (bundle.error) return json(500, { error: 'Unable to resolve OTA channel.' })
    await ctx.supabaseAdmin.from('ota_device_events').insert({ device_id: deviceId, bundle_id: bundle.data?.id ?? null, event_type: eventType, detail: { currentVersion } })
    if (!bundle.data) return json(200, { update: null, enrollment: 'ASSIGNED_NO_BUNDLE' })
    return json(200, { update: { id: bundle.data.id, version: bundle.data.version, minNativeVersion: bundle.data.min_native_version, url: bundle.data.release_url, sha256: bundle.data.sha256, sizeBytes: bundle.data.size_bytes } })
  }),
}
