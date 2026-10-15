import { execFileSync } from 'node:child_process'
import crypto from 'node:crypto'
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
    build:'abcdefab.10',
    nativeBuildNumber:10010,
    commit:'abcdefabcdefabcdefabcdefabcdefabcdefabcd',
    productionLocked:true,
    webBundleSha256:'0'.repeat(64),
    nativeWebVerification:{
      gate:'F10A_NATIVE_WEB_PARITY',
      status:'PASS',
      platform,
      verifiedFileCount:2,
      nativeFileCount:2,
      webBundleSha256:'0'.repeat(64),
      evidencePath:`INVEN3-${platform}-native-web-evidence.json`,
      evidenceSha256:platform==='android'?'1'.repeat(64):'2'.repeat(64),
    },
    artifacts:platform==='android'
      ? [
          {path:'app.apk',bytes:1,sha256:'a'.repeat(64)},
          {path:'app.aab',bytes:1,sha256:'b'.repeat(64)},
        ]
      : [{path:'app.ipa',bytes:1,sha256:'a'.repeat(64)}],
    ...overrides,
  }
}

function write(dir:string,a= evidence('android'),i=evidence('ios')) {
  fs.writeFileSync(path.join(dir,'artifacts/release/INVEN3-android-candidate-evidence.json'),JSON.stringify(a))
  fs.writeFileSync(path.join(dir,'artifacts/release/INVEN3-ios-candidate-evidence.json'),JSON.stringify(i))
}

function sha256(file:string) {
  return crypto.createHash('sha256').update(fs.readFileSync(file)).digest('hex')
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
    expect(summary.platforms.android.candidateEvidencePath).toBe('artifacts/release/INVEN3-android-candidate-evidence.json')
    expect(summary.platforms.ios.candidateEvidencePath).toBe('artifacts/release/INVEN3-ios-candidate-evidence.json')
    expect(summary.platforms.android.candidateEvidenceSha256).toBe(
      sha256(path.join(dir,'artifacts/release/INVEN3-android-candidate-evidence.json')),
    )
    expect(summary.platforms.ios.candidateEvidenceSha256).toBe(
      sha256(path.join(dir,'artifacts/release/INVEN3-ios-candidate-evidence.json')),
    )
  })

  test('rejects different builds',()=>{
    const dir=temp(); write(dir,evidence('android'),evidence('ios',{build:'abcdefab.11'}))
    const result=run(dir)
    expect(result.ok).toBe(false)
    expect(result.status).toBe(77)
    expect(result.stderr).toContain('platform parity mismatch for build')
  })

  test('rejects a build identity not bound to the candidate commit',()=>{
    const dir=temp(); write(dir,evidence('android',{build:'deadbeef.10'}),evidence('ios'))
    const result=run(dir)
    expect(result.ok).toBe(false)
    expect(result.status).toBe(76)
    expect(result.stderr).toContain('candidate build identity is invalid')
  })

  test('rejects Android candidate without an AAB',()=>{
    const dir=temp()
    write(dir,evidence('android',{artifacts:[{path:'app.apk',bytes:1,sha256:'a'.repeat(64)}]}),evidence('ios'))
    const result=run(dir)
    expect(result.ok).toBe(false)
    expect(result.status).toBe(76)
    expect(result.stderr).toContain('artifact evidence is invalid for platform')
  })

  test('rejects candidate artifact path escaping the evidence root',()=>{
    const dir=temp()
    const artifacts=[
      {path:'../app.apk',bytes:1,sha256:'a'.repeat(64)},
      {path:'app.aab',bytes:1,sha256:'b'.repeat(64)},
    ]
    write(dir,evidence('android',{artifacts}),evidence('ios'))
    const result=run(dir)
    expect(result.ok).toBe(false)
    expect(result.status).toBe(76)
    expect(result.stderr).toContain('artifact evidence is invalid for platform')
  })

  test('rejects unsafe native web evidence path',()=>{
    const dir=temp()
    const nativeWebVerification={...evidence('android').nativeWebVerification,evidencePath:'../native.json'}
    write(dir,evidence('android',{nativeWebVerification}),evidence('ios'))
    const result=run(dir)
    expect(result.ok).toBe(false)
    expect(result.status).toBe(78)
  })

  test('rejects iOS candidate containing a non-IPA artifact',()=>{
    const dir=temp()
    write(dir,evidence('android'),evidence('ios',{artifacts:[{path:'app.zip',bytes:1,sha256:'a'.repeat(64)}]}))
    const result=run(dir)
    expect(result.ok).toBe(false)
    expect(result.status).toBe(76)
    expect(result.stderr).toContain('artifact evidence is invalid for platform')
  })

  test('rejects different native build numbers',()=>{
    const dir=temp(); write(dir,evidence('android'),evidence('ios',{nativeBuildNumber:10011}))
    const result=run(dir)
    expect(result.ok).toBe(false)
    expect(result.status).toBe(77)
    expect(result.stderr).toContain('platform parity mismatch for nativeBuildNumber')
  })

  test('rejects different commits',()=>{
    const dir=temp(); write(dir,evidence('android'),evidence('ios',{commit:'bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb',build:'bbbbbbbb.10'}))
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

  test('rejects a candidate with inconsistent native exact file count',()=>{
    const dir=temp()
    const invalidNativeWeb={...evidence('android').nativeWebVerification,nativeFileCount:3}
    write(dir,evidence('android',{nativeWebVerification:invalidNativeWeb}),evidence('ios'))
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
