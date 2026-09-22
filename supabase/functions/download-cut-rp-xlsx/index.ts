// Follow this setup guide to integrate the Deno language server with your editor:
// https://deno.land/manual/getting_started/setup_your_environment
// This enables autocomplete, go to definition, etc.

// Setup type definitions for built-in Supabase Runtime APIs
import "@supabase/functions-js/edge-runtime.d.ts";
import { withSupabase } from "@supabase/server";

// This endpoint uses 'publishable' | 'secret' access, apiKey is required.
// Use publishable for Client-facing, key-validated endpoints
// Use secret for Server-to-server, internal calls
export default {
  fetch: withSupabase({ auth: 'user' }, async (req, ctx) => {
    const { cutId } = await req.json()
    if (typeof cutId !== 'string') return Response.json({ error: 'cutId is required' }, { status: 400 })
    const file = await ctx.supabase.rpc('get_cut_file_download', { p_cut_id: cutId })
    if (file.error) return Response.json({ error: file.error.message }, { status: 403 })
    const signed = await ctx.supabaseAdmin.storage.from('inventory-rp').createSignedUrl(file.data.storage_path, 60, { download: file.data.file_name })
    if (signed.error) return Response.json({ error: signed.error.message }, { status: 500 })
    return Response.json({ signedUrl: signed.data.signedUrl, fileName: file.data.file_name })
  }),
};

/* To invoke locally:

  1. Run `supabase start` (see: https://supabase.com/docs/reference/cli/supabase-start)
  2. Make an HTTP request:

  curl -i --location --request POST 'http://127.0.0.1:54321/functions/v1/download-cut-rp-xlsx' \
    --header 'apiKey: sb_publishable_ACJWlzQHlZjBrEguHvfOxg_3BJgxAaH' \
    --data '{"name":"Functions"}'

*/
