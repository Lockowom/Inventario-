// Follow this setup guide to integrate the Deno language server with your editor:
// https://deno.land/manual/getting_started/setup_your_environment
// This enables autocomplete, go to definition, etc.

// Setup type definitions for built-in Supabase Runtime APIs
import "@supabase/functions-js/edge-runtime.d.ts";
import { withSupabase } from "@supabase/server";
import * as XLSX from 'npm:@e965/xlsx@0.20.3'
import { excelSerial, isoDateUtc, RP_HEADERS, rpRow } from '../_shared/rp-contract.ts'

const mime = 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet'
const headers = RP_HEADERS
function create(rows: Record<string, unknown>[]) {
  const sheet = XLSX.utils.aoa_to_sheet([[...headers], ...rows.map((r) => rpRow(r as never))], { cellDates: true })
  sheet['!ref'] = `A1:I${rows.length + 1}`
  for (let n=2;n<=rows.length+1;n+=1) { for (const c of ['A','B','C','D','F','G','I']) { const cell=sheet[`${c}${n}`]; if(cell) cell.z='@' }; const serial=excelSerial(rows[n-2]?.fecha_vencimiento as string|null|undefined);if(serial!==null)sheet[`E${n}`]={t:'n',v:serial,z:'dd-mm-yyyy'}; const q=sheet[`H${n}`]; if(q) q.z='0' }
  const workbook=XLSX.utils.book_new(); XLSX.utils.book_append_sheet(workbook,sheet,'INVENTARIO'); return new Uint8Array(XLSX.write(workbook,{bookType:'xlsx',type:'array',cellDates:true}))
}
function validate(bytes: Uint8Array, expected: Record<string, unknown>[]) { const book=XLSX.read(bytes,{type:'array',cellDates:true,cellFormula:true}); const sheet=book.Sheets.INVENTARIO; if(book.SheetNames.length!==1 || book.SheetNames[0]!=='INVENTARIO' || !sheet || sheet['!ref']!==`A1:I${expected.length+1}` || JSON.stringify(XLSX.utils.sheet_to_json(sheet,{header:1,raw:true,defval:null})[0])!==JSON.stringify(headers)) throw new Error('Invalid RP XLSX contract'); for(const cell of Object.values(sheet)) if(typeof cell==='object' && cell && 'f' in cell) throw new Error('XLSX formulas are forbidden'); const values=XLSX.utils.sheet_to_json(sheet,{header:1,raw:true,defval:null}); expected.forEach((row,index)=>{const actual=values[index+1] as unknown[];const want=rpRow(row as never);if(!actual||actual.length!==9||actual.some((v,n)=>n===4?false:v!==want[n]))throw new Error(`XLSX row ${index+1} mismatches snapshot`);const d=sheet[`E${index+2}`];const p=d?.t==='n'?XLSX.SSF.parse_date_code(Number(d.v)):null;const date=d?.v instanceof Date?d.v:p?new Date(Date.UTC(p.y,p.m-1,p.d)):null;if(row.fecha_vencimiento?(!d||!['n','d'].includes(d.t??'')||isoDateUtc(date)!==row.fecha_vencimiento):actual[4]!==null)throw new Error(`XLSX date ${index+1} mismatches snapshot`) }) }

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
      const canonicalRequestId = claim.data.request_id as string
      const name=`INVEN3_${String(source.data.inventory_id).replaceAll('-','').toUpperCase()}_CORTE_${String(source.data.cut_number).padStart(3,'0')}.xlsx`, path=`inventory/${source.data.inventory_id}/cuts/${cutId}/${name}`
      let bytes:Uint8Array;let hash:string;let size:number
      if(claim.data.action==='RECOVER'){const existing=await ctx.supabaseAdmin.storage.from('inventory-rp').download(source.data.storage_path);if(existing.error)throw existing.error;bytes=new Uint8Array(await existing.data.arrayBuffer());hash=Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256',bytes))).map(n=>n.toString(16).padStart(2,'0')).join('');size=bytes.byteLength;if(hash!==source.data.sha256||size!==source.data.size_bytes)throw new Error('Stored artifact hash or size does not match official metadata')}else{bytes=create(source.data.rows);validate(bytes,source.data.rows);hash=Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256',bytes))).map(n=>n.toString(16).padStart(2,'0')).join('');size=bytes.byteLength;const uploaded=await ctx.supabaseAdmin.storage.from('inventory-rp').upload(path,bytes,{contentType:mime,upsert:false});if(uploaded.error)throw uploaded.error;const generated=await ctx.supabaseAdmin.rpc('record_cut_file_generated',{p_cut_id:cutId,p_request_id:canonicalRequestId,p_file_name:name,p_storage_path:path,p_sha256:hash,p_size_bytes:size,p_generator_version:'phase-7.0.0'});if(generated.error)throw generated.error}
      validate(bytes,source.data.rows); if(source.data.status==='ERROR'){const recovered=await ctx.supabaseAdmin.rpc('recover_cut_file_generated',{p_cut_id:cutId,p_request_id:canonicalRequestId});if(recovered.error)throw recovered.error} if(source.data.status==='VALIDATED'){const ready=await ctx.supabaseAdmin.rpc('finalize_cut_file',{p_cut_id:cutId,p_request_id:canonicalRequestId});if(ready.error)throw ready.error;return Response.json(ready.data)} const checked=await ctx.supabaseAdmin.rpc('mark_cut_file_validated',{p_cut_id:cutId,p_request_id:canonicalRequestId});if(checked.error)throw checked.error;const ready=await ctx.supabaseAdmin.rpc('finalize_cut_file',{p_cut_id:cutId,p_request_id:canonicalRequestId});if(ready.error)throw ready.error;return Response.json(ready.data)
    } catch (error) { const safe=error instanceof Error?error.message:'Generation failed safely.'; console.error('generate-cut-rp-xlsx failed', { cutId, requestId: claim.data.request_id ?? requestId, error: safe }); await ctx.supabaseAdmin.rpc('mark_cut_file_error',{p_cut_id:cutId,p_request_id:claim.data.request_id??requestId,p_message:safe.slice(0,500)}); return Response.json({ error: safe }, { status: 500 }) }
  }),
};

/* To invoke locally:

  1. Run `supabase start` (see: https://supabase.com/docs/reference/cli/supabase-start)
  2. Make an HTTP request:

  curl -i --location --request POST 'http://127.0.0.1:54321/functions/v1/generate-cut-rp-xlsx' \
    --header 'apiKey: sb_publishable_ACJWlzQHlZjBrEguHvfOxg_3BJgxAaH' \
    --data '{"name":"Functions"}'

*/
