import { execFileSync } from 'node:child_process'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { afterEach, describe, expect, test } from 'vitest'

const script = path.resolve(process.cwd(), 'scripts/release-bundle-audit.mjs')
const dirs: string[] = []

function make(content: string, productionLocked = true) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'inven3-bundle-audit-'))
  dirs.push(dir)
  fs.writeFileSync(path.join(dir,'release-policy.json'), JSON.stringify({
    product:'INVEN3',
    qaSupabaseProjectRef:'uazunvlxlszdyweddxtb',
    productionLocked,
  }))
  fs.mkdirSync(path.join(dir,'dist/assets'), { recursive:true })
  fs.writeFileSync(path.join(dir,'dist/index.html'), '<div id="root"></div>')
  fs.writeFileSync(path.join(dir,'dist/assets/app.js'), content)
  return dir
}

function run(dir: string) {
  try {
    const stdout=execFileSync(process.execPath,[script],{
      cwd:dir,encoding:'utf8',stdio:['ignore','pipe','pipe']
    })
    return {ok:true,stdout,stderr:'',status:0}
  } catch(error) {
    const e=error as {stdout?:string|Buffer;stderr?:string|Buffer;status?:number}
    return {ok:false,stdout:String(e.stdout??''),stderr:String(e.stderr??''),status:e.status??-1}
  }
}

afterEach(()=>{
  for(const dir of dirs.splice(0)) fs.rmSync(dir,{recursive:true,force:true})
})

describe('F10A built bundle audit',()=>{
  test('accepts a QA bundle without server secrets',()=>{
    const dir=make('const api="https://uazunvlxlszdyweddxtb.supabase.co";')
    const result=run(dir)
    expect(result.ok).toBe(true)
    expect(result.stdout).toContain('F10A_BUNDLE_AUDIT')
  })

  test('rejects localhost backend residue',()=>{
    const dir=make('const qa="https://uazunvlxlszdyweddxtb.supabase.co"; const local="http://127.0.0.1:54321";')
    const result=run(dir)
    expect(result.ok).toBe(false)
    expect(result.status).toBe(63)
  })

  test('rejects Supabase server secret material',()=>{
    const dir=make('const qa="https://uazunvlxlszdyweddxtb.supabase.co"; const x="sb_secret_forbidden";')
    const result=run(dir)
    expect(result.ok).toBe(false)
    expect(result.status).toBe(63)
  })

  test('rejects a second Supabase project in the same bundle',()=>{
    const dir=make('const qa="https://uazunvlxlszdyweddxtb.supabase.co"; const foreign="https://aaaaaaaaaaaaaaaaaaaa.supabase.co";')
    const result=run(dir)
    expect(result.ok).toBe(false)
    expect(result.status).toBe(63)
    expect(result.stderr).toContain('unauthorized Supabase host')
  })

  test('rejects a legacy service_role JWT embedded in the bundle',()=>{
    const header=Buffer.from(JSON.stringify({alg:'HS256',typ:'JWT'})).toString('base64url')
    const payload=Buffer.from(JSON.stringify({role:'service_role'})).toString('base64url')
    const dir=make(`const qa="https://uazunvlxlszdyweddxtb.supabase.co"; const forbidden="${header}.${payload}.signature";`)
    const result=run(dir)
    expect(result.ok).toBe(false)
    expect(result.status).toBe(63)
    expect(result.stderr).toContain('service_role JWT')
  })

  test('rejects a bundle that does not contain the QA backend host',()=>{
    const dir=make('console.log("no backend")')
    const result=run(dir)
    expect(result.ok).toBe(false)
    expect(result.status).toBe(62)
  })

  test('refuses audit when production lock is disabled',()=>{
    const dir=make('const qa="https://uazunvlxlszdyweddxtb.supabase.co";', false)
    const result=run(dir)
    expect(result.ok).toBe(false)
    expect(result.status).toBe(61)
  })
})
