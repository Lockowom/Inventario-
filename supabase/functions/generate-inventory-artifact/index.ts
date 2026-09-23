/* eslint-disable @typescript-eslint/no-explicit-any -- source is a discriminated JSONB document emitted by the server-only RPC. */
import '@supabase/functions-js/edge-runtime.d.ts'
import { withSupabase } from '@supabase/server'
import { buildSnapshot, buildTechnicalBackup, generateRectificationXlsx, rectificationFileName, sha256, validateRectificationXlsx, validateSnapshot, validateTechnicalBackup } from '../_shared/artifact-contract.ts'

const bucket = 'inventory-rp'
const mime = (type: string) => type === 'RECTIFICATION_XLSX' ? 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' : type === 'SNAPSHOT' ? 'application/json' : 'application/zip'
const safe = (error: unknown) => error instanceof Error ? error.message.slice(0, 500) : 'Artifact generation failed safely.'
const filename = (source: any) => source.generation.artifact_type === 'RECTIFICATION_XLSX' ? rectificationFileName(source) : source.generation.artifact_type === 'SNAPSHOT' ? `INVEN3_${String(source.inventory.id).replaceAll('-', '').toUpperCase()}_CORTE_${String(source.cut.cut_number).padStart(3, '0')}_SNAPSHOT.json` : `INVEN3_${String(source.inventory.id).replaceAll('-', '').toUpperCase()}_${source.generation.scope}.zip`
async function bytesFor(source: any) {
  if (source.generation.artifact_type === 'RECTIFICATION_XLSX') return generateRectificationXlsx(source)
  if (source.generation.artifact_type === 'SNAPSHOT') return buildSnapshot(source)
  return buildTechnicalBackup(source)
}
async function validate(bytes: Uint8Array, source: any) {
  if (source.generation.artifact_type === 'RECTIFICATION_XLSX') return validateRectificationXlsx(bytes, source)
  if (source.generation.artifact_type === 'SNAPSHOT') return validateSnapshot(bytes, source)
  return validateTechnicalBackup(bytes, source)
}

export default { fetch: withSupabase({ auth: 'user' }, async (req, ctx) => {
  const { artifact_generation_id: id } = await req.json().catch(() => ({}))
  if (typeof id !== 'string') return Response.json({ error: 'artifact_generation_id is required' }, { status: 400 })
  const authorized = await ctx.supabase.rpc('authorize_inventory_artifact_generation', { p_artifact_generation_id: id })
  if (authorized.error) return Response.json({ error: authorized.error.message }, { status: 403 })
  const claim = await ctx.supabaseAdmin.rpc('claim_inventory_artifact_generation', { p_artifact_generation_id: id })
  if (claim.error) return Response.json({ error: claim.error.message }, { status: 409 })
  if (claim.data.action === 'READY') return Response.json({ status: 'READY', idempotent: true })
  try {
    const sourceResult = await ctx.supabaseAdmin.rpc('get_inventory_artifact_source', { p_artifact_generation_id: id })
    if (sourceResult.error) throw sourceResult.error
    const source = sourceResult.data
    let bytes: Uint8Array
    if (claim.data.action === 'RECOVER' || claim.data.action === 'VALIDATE' || claim.data.action === 'FINALIZE') {
      const downloaded = await ctx.supabaseAdmin.storage.from(bucket).download(source.generation.storage_path)
      if (downloaded.error) throw downloaded.error
      bytes = new Uint8Array(await downloaded.data.arrayBuffer())
      if (source.generation.sha256 && (await sha256(bytes) !== source.generation.sha256 || bytes.byteLength !== source.generation.size_bytes)) throw new Error('Stored artifact hash or size does not match canonical metadata')
      await validate(bytes, source)
      if (claim.data.action === 'RECOVER') { const recovered = await ctx.supabaseAdmin.rpc('recover_inventory_artifact_generated', { p_artifact_generation_id: id }); if (recovered.error) throw recovered.error }
    } else {
      bytes = await bytesFor(source); await validate(bytes, source)
      const existing = await ctx.supabaseAdmin.storage.from(bucket).download(source.generation.storage_path)
      if (!existing.error) {
        const stored = new Uint8Array(await existing.data.arrayBuffer())
        if (await sha256(stored) !== await sha256(bytes) || stored.byteLength !== bytes.byteLength) throw new Error('Reserved storage path contains unexpected bytes')
      } else {
        const uploaded = await ctx.supabaseAdmin.storage.from(bucket).upload(source.generation.storage_path, bytes, { contentType: mime(source.generation.artifact_type), upsert: false })
        if (uploaded.error) throw uploaded.error
      }
      const generated = await ctx.supabaseAdmin.rpc('record_inventory_artifact_generated', { p_artifact_generation_id: id, p_file_name: filename(source), p_sha256: await sha256(bytes), p_size_bytes: bytes.byteLength, p_generator_version: 'phase-8c.0.0' })
      if (generated.error) throw generated.error
    }
    const validated = await ctx.supabaseAdmin.rpc('mark_inventory_artifact_validated', { p_artifact_generation_id: id }); if (validated.error) throw validated.error
    const ready = await ctx.supabaseAdmin.rpc('finalize_inventory_artifact', { p_artifact_generation_id: id }); if (ready.error) throw ready.error
    return Response.json(ready.data)
  } catch (error) {
    const message = safe(error); console.error('generate-inventory-artifact failed', { artifact_generation_id: id, error: message })
    await ctx.supabaseAdmin.rpc('mark_inventory_artifact_error', { p_artifact_generation_id: id, p_message: message })
    return Response.json({ error: message }, { status: 500 })
  }
}) }
