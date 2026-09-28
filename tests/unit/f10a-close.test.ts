import { execFileSync } from 'node:child_process'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { afterEach, describe, expect, test } from 'vitest'

const script = path.resolve(process.cwd(), 'scripts/f10a-close.mjs')
const dirs: string[] = []
const sha = 'b'.repeat(40)

function temp() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'inven3-f10a-close-'))
  dirs.push(dir)
  fs.mkdirSync(path.join(dir, 'artifacts/release'), { recursive: true })
  fs.writeFileSync(path.join(dir, 'release-policy.json'), JSON.stringify({
    product:'INVEN3', productionLocked:true
  }))
  return dir
}

function candidate(platform:'android'|'ios', nativeBuildNumber:number) {
  return {
    gate:'F10A_RELEASE_CANDIDATE',
    status:'READY_FOR_BETA_SMOKE',
    platform,
    version:'1.0.0',
    environment:'qa',
    channel:'beta',
    commit:sha,
    productionLocked:true,
    webBundleSha256:'webhash',
    nativeBuildNumber,
  }
}

function smoke(platform:'android'|'ios', native_build_number:number, overrides:Record<string,unknown>={}) {
  return {
    execution_id:`smoke-${platform}`,
    gate:'F10A_BETA_SMOKE',
    status:'PASS',
    platform,
    candidate_sha:sha,
    version:'1.0.0',
    environment:'qa',
    channel:'beta',
    production_locked:true,
    native_build_number,
    defects:[],
    ...overrides,
  }
}

function write(dir:string, overrides:{
  android?:Record<string,unknown>,
  ios?:Record<string,unknown>,
  parity?:Record<string,unknown>,
  androidSmoke?:Record<string,unknown>,
  iosSmoke?:Record<string,unknown>,
}={}) {
  const a={...candidate('android',10010),...(overrides.android??{})}
  const i={...candidate('ios',10011),...(overrides.ios??{})}
  const p={
    gate:'F10A_PLATFORM_PARITY', status:'READY_FOR_BETA_SMOKE', version:'1.0.0',
    environment:'qa', channel:'beta', commit:sha, productionLocked:true, webBundleSha256:'webhash',
    ...(overrides.parity??{})
  }
  const as={...smoke('android',10010),...(overrides.androidSmoke??{})}
  const is={...smoke('ios',10011),...(overrides.iosSmoke??{})}
  const files={
    'android.json':a, 'ios.json':i, 'parity.json':p, 'android-smoke.json':as, 'ios-smoke.json':is
  }
  for(const [name,value] of Object.entries(files)) fs.writeFileSync(path.join(dir,name),JSON.stringify(value))
}

function run(dir:string) {
  try {
    const stdout=execFileSync(process.execPath,[
      script,
      '--android-candidate','android.json',
      '--ios-candidate','ios.json',
      '--parity','parity.json',
      '--android-smoke','android-smoke.json',
      '--ios-smoke','ios-smoke.json',
    ],{cwd:dir,encoding:'utf8',stdio:['ignore','pipe','pipe']})
    return {ok:true,status:0,stdout,stderr:''}
  } catch(error) {
    const e=error as {stdout?:string|Buffer;stderr?:string|Buffer;status?:number}
    return {ok:false,status:e.status??-1,stdout:String(e.stdout??''),stderr:String(e.stderr??'')}
  }
}

afterEach(()=>{for(const dir of dirs.splice(0)) fs.rmSync(dir,{recursive:true,force:true})})

describe('F10A evidence-driven closure',()=>{
  test('closes when both candidates, parity and both smokes pass',()=>{
    const dir=temp(); write(dir)
    const result=run(dir)
    expect(result.ok).toBe(true)
    expect(result.stdout).toContain('F10A_RELEASE_ENGINEERING')
    const closure=JSON.parse(fs.readFileSync(path.join(dir,'artifacts/release/INVEN3-F10A-closure.json'),'utf8'))
    expect(closure.status).toBe('PASS')
    expect(closure.nextGate).toBe('F10B_NOT_AUTHORIZED')
  })

  test('rejects a failed iOS smoke',()=>{
    const dir=temp(); write(dir,{iosSmoke:{status:'FAIL'}})
    const result=run(dir)
    expect(result.ok).toBe(false)
    expect(result.status).toBe(103)
  })

  test('rejects smoke built from another candidate SHA',()=>{
    const dir=temp(); write(dir,{androidSmoke:{candidate_sha:'c'.repeat(40)}})
    const result=run(dir)
    expect(result.ok).toBe(false)
    expect(result.status).toBe(110)
  })

  test('rejects closure when production lock is disabled',()=>{
    const dir=temp()
    fs.writeFileSync(path.join(dir,'release-policy.json'),JSON.stringify({product:'INVEN3',productionLocked:false}))
    write(dir)
    const result=run(dir)
    expect(result.ok).toBe(false)
    expect(result.status).toBe(94)
  })
})
