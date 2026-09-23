import '@supabase/functions-js/edge-runtime.d.ts'
import { withSupabase } from '@supabase/server'

export default { fetch: withSupabase({ auth: 'user' }, async (req, ctx) => {
  const { artifact_generation_id: id } = await req.json().catch(() => ({}))
  if (typeof id !== 'string') return Response.json({ error: 'artifact_generation_id is required' }, { status: 400 })
  const artifact = await ctx.supabase.rpc('get_inventory_artifact_download', { p_artifact_generation_id: id })
  if (artifact.error) return Response.json({ error: artifact.error.message }, { status: 403 })
  const signed = await ctx.supabaseAdmin.storage.from('inventory-rp').createSignedUrl(artifact.data.storage_path, 60, { download: artifact.data.file_name })
  if (signed.error) return Response.json({ error: signed.error.message }, { status: 500 })
  return Response.json({ signedUrl: signed.data.signedUrl, fileName: artifact.data.file_name, sha256: artifact.data.sha256, sizeBytes: artifact.data.size_bytes })
}) }
