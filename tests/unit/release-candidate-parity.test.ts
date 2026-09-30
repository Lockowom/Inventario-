import { execFileSync } from 'node:child_process'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { afterEach, describe, expect, test } from 'vitest'

const script = path.resolve(process.cwd(), 'scripts/release-candidate-parity.mjs')
const dirs: string[] = []

function temp() {
  const dir=fs.mkdtempSync(path.join(os.tmpdir(),'inven3-parity-'))
  dirs.push(dir)
  fs.mkdirSync(path.join(dir,'artifacts/release'),{recursive:true})
  return dir
}

function evidence(platform:'android'|'ios', overrides:Record<string,unknown>={}) {
  return {
    schemaVersion:1,
    product:'INVEN3',
    gate:'F10A_RELEASE_CANDIDATE',
    status:'READY_FOR_BETA_SMOKE',
    platform,
    version:'1.0.0',
    environment:'qa',
    channel:'beta',
    build:platform==='android'?'abc.10':'abc.11',
    nativeBuildNumber:platform==='android'?10010:10011,
    commit:'abcdefabcdefabcdefabcdefabcdefabcdefabcd',
    productionLocked:true,
    webBundleSha256:'0'.repeat(64),
    nativeWebVerification:{
      gate:'F10A_NATIVE_WEB_PARITY',
      status:'PASS',
      platform,
      verifiedFileCount:2,
      webBundleSha256:'0'.repeat(64),
      evidencePath:`INVEN3-${platform}-native-web-evidence.json`,
      evidenceSha256:platform==='android'?'1'.repeat(64):'2'.repeat(64),
    },
    artifacts:[{path:platform==='android'?'app.apk':'app.ipa',bytes:1,sha256:'a'.repeat(64)}],
    ...overrides,
  }
}

function write(dir:string,a= evidence('android'),i=evidence('ios')) {
  fs.writeFileSync(path.join(dir,'artifacts/release/INVEN3-android-candidate-evidence.json'),JSON.stringify(a))
  fs.writeFileSync(path.join(dir,'artifacts/release/INVEN3-ios-candidate-evidence.json'),JSON.stringify(i))
}

function run(dir:string) {
  try {
    const stdout=execFileSync(process.execPath,[script],{cwd:dir,encoding:'utf8',stdio:['ignore','pipe','pipe']})
    return {ok:true,stdout,stderr:'',status:0}
  } catch(error) {
    const e=error as {stdout?:string|Buffer;stderr?:string|Buffer;status?:number}
    return {ok:false,stdout:String(e.stdout??''),stderr:String(e.stderr??''),status:e.status??-1}
  }
}

afterEach(()=>{for(const dir of dirs.splice(0)) fs.rmSync(dir,{recursive:true,force:true})})

describe('F10A platform parity',()=>{
  test('accepts Android and iOS evidence from the same web candidate',()=>{
    const dir=temp(); write(dir)
    const result=run(dir)
    expect(result.ok).toBe(true)
    expect(result.stdout).toContain('F10A_PLATFORM_PARITY')
    const summary=JSON.parse(fs.readFileSync(path.join(dir,'artifacts/release/INVEN3-f10a-platform-parity.json'),'utf8'))
    expect(summary.status).toBe('READY_FOR_BETA_SMOKE')
  })

  test('rejects different commits',()=>{
    const dir=temp(); write(dir,evidence('android'),evidence('ios',{commit:'bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb'}))
    const result=run(dir)
    expect(result.ok).toBe(false)
    expect(result.status).toBe(77)
  })

  test('rejects different web bundle hashes',()=>{
    const dir=temp(); write(dir,evidence('android'),evidence('ios',{
      webBundleSha256:'3'.repeat(64),
      nativeWebVerification:{
        ...evidence('ios').nativeWebVerification,
        webBundleSha256:'3'.repeat(64),
      },
    }))
    const result=run(dir)
    expect(result.ok).toBe(false)
    expect(result.status).toBe(77)
  })

  test('rejects a candidate without native web parity evidence',()=>{
    const dir=temp(); write(dir,evidence('android',{nativeWebVerification:null}),evidence('ios'))
    const result=run(dir)
    expect(result.ok).toBe(false)
    expect(result.status).toBe(78)
  })

  test('rejects a candidate without production lock',()=>{
    const dir=temp(); write(dir,evidence('android',{productionLocked:false}),evidence('ios'))
    const result=run(dir)
    expect(result.ok).toBe(false)
    expect(result.status).toBe(74)
  })
})
