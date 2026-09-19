// Follow this setup guide to integrate the Deno language server with your editor:
// https://deno.land/manual/getting_started/setup_your_environment
// This enables autocomplete, go to definition, etc.

// Setup type definitions for built-in Supabase Runtime APIs
import "@supabase/functions-js/edge-runtime.d.ts";
import { withSupabase } from "@supabase/server";
import * as XLSX from 'npm:@e965/xlsx@0.20.3'

const mime = 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet'
const headers = ['CODIGO', 'SERIE', 'PARTIDA', 'PIEZA DEL PRODUCTO', 'FECHA DE VENCIMIENTO', 'Talla del producto', 'Color del Producto', 'Cantidad Contada', 'DESCRIPCION']
const value = (input: unknown) => input ?? ''
function create(rows: Record<string, unknown>[]) {
  const sheet = XLSX.utils.aoa_to_sheet([headers, ...rows.map((r) => [r.codigo,value(r.serie),value(r.partida),value(r.pieza_producto),r.fecha_vencimiento ? new Date(`${r.fecha_vencimiento}T00:00:00.000Z`) : '',value(r.talla),value(r.color),r.cantidad_contada,r.descripcion])], { cellDates: true })
  sheet['!ref'] = `A1:I${rows.length + 1}`
  for (let n=2;n<=rows.length+1;n+=1) { for (const c of ['A','B','C','D','F','G','I']) { const cell=sheet[`${c}${n}`]; if(cell) cell.z='@' }; const d=sheet[`E${n}`]; if(d?.v) d.z='dd-mm-yyyy'; const q=sheet[`H${n}`]; if(q) q.z='0' }
  const workbook=XLSX.utils.book_new(); XLSX.utils.book_append_sheet(workbook,sheet,'INVENTARIO'); return new Uint8Array(XLSX.write(workbook,{bookType:'xlsx',type:'array',cellDates:true}))
}
function validate(bytes: Uint8Array, count: number) { const book=XLSX.read(bytes,{type:'array',cellDates:true,cellFormula:true}); const sheet=book.Sheets.INVENTARIO; if(book.SheetNames.length!==1 || book.SheetNames[0]!=='INVENTARIO' || !sheet || sheet['!ref']!==`A1:I${count+1}` || JSON.stringify(XLSX.utils.sheet_to_json(sheet,{header:1,raw:true,defval:''})[0])!==JSON.stringify(headers)) throw new Error('Invalid RP XLSX contract'); for(const cell of Object.values(sheet)) if(typeof cell==='object' && cell && 'f' in cell) throw new Error('XLSX formulas are forbidden') }

// This endpoint uses 'publishable' | 'secret' access, apiKey is required.
// Use publishable for Client-facing, key-validated endpoints
// Use secret for Server-to-server, internal calls
export default {
  fetch: withSupabase({ auth: 'user' }, async (req, ctx) => {
    const { cutId, requestId } = await req.json()
    if (typeof cutId !== 'string' || typeof requestId !== 'string') return Response.json({ error: 'cutId and requestId are required' }, { status: 400 })
    const claim = await ctx.supabase.rpc('request_cut_file_generation', { p_cut_id: cutId, p_request_id: requestId })
    if (claim.error) return Response.json({ error: claim.error.message }, { status: 403 })
    if (claim.data.action === 'READY') return Response.json(claim.data)
    try {
      const source = await ctx.supabaseAdmin.rpc('get_cut_export_source', { p_cut_id: cutId }); if (source.error) throw source.error
      const bytes = create(source.data.rows); validate(bytes, source.data.record_count)
      const name=`INVEN3_${String(source.data.inventory_id).replaceAll('-','').toUpperCase()}_CORTE_${String(source.data.cut_number).padStart(3,'0')}.xlsx`, path=`inventory/${source.data.inventory_id}/cuts/${cutId}/${name}`
      const hash=Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256',bytes))).map((n)=>n.toString(16).padStart(2,'0')).join('')
      const uploaded=await ctx.supabaseAdmin.storage.from('inventory-rp').upload(path,bytes,{contentType:mime,upsert:true}); if(uploaded.error) throw uploaded.error
      const generated=await ctx.supabaseAdmin.rpc('record_cut_file_generated',{p_cut_id:cutId,p_request_id:requestId,p_file_name:name,p_storage_path:path,p_sha256:hash,p_size_bytes:bytes.byteLength,p_generator_version:'phase-7.0.0'}); if(generated.error) throw generated.error
      const stored=await ctx.supabaseAdmin.storage.from('inventory-rp').download(path); if(stored.error) throw stored.error; validate(new Uint8Array(await stored.data.arrayBuffer()),source.data.record_count)
      const checked=await ctx.supabaseAdmin.rpc('mark_cut_file_validated',{p_cut_id:cutId,p_request_id:requestId}); if(checked.error) throw checked.error
      const ready=await ctx.supabaseAdmin.rpc('finalize_cut_file',{p_cut_id:cutId,p_request_id:requestId}); if(ready.error) throw ready.error; return Response.json(ready.data)
    } catch (error) { return Response.json({ error: error instanceof Error ? error.message : 'Generation failed safely.' }, { status: 500 }) }
  }),
};

/* To invoke locally:

  1. Run `supabase start` (see: https://supabase.com/docs/reference/cli/supabase-start)
  2. Make an HTTP request:

  curl -i --location --request POST 'http://127.0.0.1:54321/functions/v1/generate-cut-rp-xlsx' \
    --header 'apiKey: sb_publishable_ACJWlzQHlZjBrEguHvfOxg_3BJgxAaH' \
    --data '{"name":"Functions"}'

*/
