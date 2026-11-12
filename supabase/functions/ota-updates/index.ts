import '@supabase/functions-js/edge-runtime.d.ts'
import { withSupabase } from '@supabase/server'

const deviceIdPattern = /^[A-Za-z0-9._:-]{8,200}$/
const versionPattern = /^\d+\.\d+\.\d{2}\.\d{2}(?:-qa\.\d+)?$/
function json(status: number, body: Record<string, unknown>) { return Response.json(body, { status }) }

// qa-beta is selected only by this trusted server. The native client neither
// sends a channel nor has permission to change its own updater channel.
const qaChannel = 'qa-beta'

/** Authenticated Android QA application check. */
export default {
  fetch: withSupabase({ auth: 'user' }, async (request, ctx) => {
    if (request.method !== 'POST') return json(405, { error: 'Method not allowed.' })
    const actor = await ctx.supabase.auth.getUser()
    if (actor.error || !actor.data.user) return json(401, { error: 'Authentication required.' })
    let body: Record<string, unknown>
    try { body = await request.json() } catch { return json(400, { error: 'Body must be JSON.' }) }
    const deviceId = typeof body.deviceId === 'string' ? body.deviceId.trim() : ''
    const nativeVersion = typeof body.nativeVersion === 'string' ? body.nativeVersion.trim() : ''
    const nativeVersionCode = typeof body.nativeVersionCode === 'number' && Number.isSafeInteger(body.nativeVersionCode) && body.nativeVersionCode > 0 ? body.nativeVersionCode : null
    // APK 0.0.00.02 already contains the updater but predates the effective
    // app-version field. Keep that first OTA bridge compatible: `builtin`
    // means the effective app version is the native shell until a bundle is
    // activated. New clients always send appVersion explicitly.
    const requestedAppVersion = typeof body.appVersion === 'string' ? body.appVersion.trim() : ''
    const requestedCurrentVersion = typeof body.currentBundleVersion === 'string' ? body.currentBundleVersion.trim() : ''
    const currentVersion = requestedCurrentVersion === 'builtin' || requestedCurrentVersion === '' ? nativeVersion : requestedCurrentVersion
    const appVersion = requestedAppVersion || currentVersion
    const eventType = typeof body.eventType === 'string' ? body.eventType : 'CHECKED'
    if (!deviceIdPattern.test(deviceId) || !versionPattern.test(nativeVersion) || !versionPattern.test(appVersion) || !versionPattern.test(currentVersion)) return json(400, { error: 'Invalid OTA device identity.' })
    if (!['CHECKED', 'DOWNLOADED', 'APPLIED', 'ROLLED_BACK', 'FAILED', 'INCOMPATIBLE'].includes(eventType)) return json(400, { error: 'Unsupported OTA event.' })
    const existing = await ctx.supabaseAdmin.from('ota_devices').select('user_id, channel_name').eq('device_id', deviceId).maybeSingle()
    if (existing.error) return json(500, { error: 'Unable to resolve OTA device.' })
    if (existing.data && existing.data.user_id !== actor.data.user.id) return json(403, { error: 'Device belongs to another user.' })
    const deviceChannel = existing.data?.channel_name ?? qaChannel
    const device = await ctx.supabaseAdmin.from('ota_devices').upsert({ device_id: deviceId, user_id: actor.data.user.id, channel_name: deviceChannel, platform: 'ANDROID', app_version: appVersion, native_version: nativeVersion, native_version_code: nativeVersionCode, current_bundle_version: currentVersion, ota_status: eventType, last_seen_at: new Date().toISOString(), last_check_at: new Date().toISOString(), last_error_code: eventType === 'FAILED' ? 'CLIENT_REPORTED_FAILURE' : null }, { onConflict: 'device_id' }).select('device_id, channel_name').single()
    if (device.error || !device.data) return json(500, { error: 'Unable to register OTA device.' })
    if (device.data.channel_name !== qaChannel) return json(500, { error: 'Invalid OTA channel configuration.' })
    const bundle = await ctx.supabaseAdmin.from('ota_bundles').select('id, version, min_native_version, min_native_version_code, release_url, sha256, size_bytes, entrypoint').eq('channel_name', device.data.channel_name).is('revoked_at', null).order('published_at', { ascending: false }).limit(1).maybeSingle()
    if (bundle.error) return json(500, { error: 'Unable to resolve OTA channel.' })
    await ctx.supabaseAdmin.from('ota_device_events').insert({ device_id: deviceId, bundle_id: bundle.data?.id ?? null, event_type: eventType, detail: { appVersion, nativeVersion, nativeVersionCode, currentVersion } })
    if (!bundle.data) return json(200, { update: null, enrollment: 'ASSIGNED_NO_BUNDLE' })
    return json(200, { update: { id: bundle.data.id, version: bundle.data.version, minNativeVersion: bundle.data.min_native_version, minVersionCode: bundle.data.min_native_version_code, url: bundle.data.release_url, sha256: bundle.data.sha256, sizeBytes: bundle.data.size_bytes, entrypoint: bundle.data.entrypoint } })
  }),
}
