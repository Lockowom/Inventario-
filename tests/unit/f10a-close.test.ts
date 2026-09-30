import { execFileSync } from 'node:child_process'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { afterEach, describe, expect, test } from 'vitest'

const script = path.resolve(process.cwd(), 'scripts/f10a-close.mjs')
const dirs: string[] = []
const sha = 'b'.repeat(40)
const webHash = 'a'.repeat(64)

function temp() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'inven3-f10a-close-'))
  dirs.push(dir)
  fs.mkdirSync(path.join(dir, 'artifacts/release'), { recursive: true })
  fs.writeFileSync(path.join(dir, 'release-policy.json'), JSON.stringify({
    product:'INVEN3', releaseVersion:'1.0.0', productionLocked:true
  }))
  return dir
}

function candidate(platform:'android'|'ios', nativeBuildNumber:number) {
  return {
    product:'INVEN3',
    gate:'F10A_RELEASE_CANDIDATE',
    status:'READY_FOR_BETA_SMOKE',
    platform,
    version:'1.0.0',
    environment:'qa',
    channel:'beta',
    build:`${sha.slice(0,8)}.10`,
    commit:sha,
    productionLocked:true,
    webBundleSha256:webHash,
    nativeBuildNumber,
    nativeWebVerification:{
      gate:'F10A_NATIVE_WEB_PARITY',
      status:'PASS',
      platform,
      verifiedFileCount:2,
      webBundleSha256:webHash,
      evidencePath:`INVEN3-${platform}-native-web-evidence.json`,
      evidenceSha256:platform === 'android' ? '7'.repeat(64) : '8'.repeat(64),
    },
    artifacts:platform === 'android'
      ? [
          { path:'INVEN3-android-lab.apk', bytes:1024, sha256:'c'.repeat(64) },
          { path:'INVEN3-android-release.aab', bytes:2048, sha256:'9'.repeat(64) },
        ]
      : [
          { path:'INVEN3-ios-unsigned.ipa', bytes:1024, sha256:'d'.repeat(64) },
        ],
  }
}

function smoke(platform:'android'|'ios', native_build_number:number, overrides:Record<string,unknown>={}) {
  return {
    execution_id:`smoke-${platform}`,
    gate:'F10A_BETA_SMOKE',
    status:'PASS',
    platform,
    candidate_sha:sha,
    candidate_evidence_ref:`INVEN3-${platform}-candidate-evidence.json`,
    source_candidate_artifact_sha256:platform === 'android' ? 'c'.repeat(64) : 'd'.repeat(64),
    installed_artifact_sha256:platform === 'android' ? 'c'.repeat(64) : 'e'.repeat(64),
    install_method:platform === 'android' ? 'local_device' : 'managed_device_lab',
    signing_provenance:platform === 'android' ? 'ephemeral_lab_signing' : 'laboratory_resign',
    version:'1.0.0',
    environment:'qa',
    channel:'beta',
    production_locked:true,
    native_build_number,
    app_display_version:`1.0.0-beta+${sha.slice(0,8)}.10`,
    device_model:'QA Device',
    os:platform === 'android' ? 'Android' : 'iOS',
    os_version:'test',
    started_at:'2026-09-28T12:00:00.000Z',
    finished_at:'2026-09-28T12:10:00.000Z',
    operator:'QA',
    checks:{
      app_launch:true,
      release_identity_qa_beta:true,
      supabase_configured:true,
      authenticated_runtime:true,
      health_non_blocking:true,
      counting_screen:true,
      my_counts_screen:true,
      synthetic_count_saved:true,
      synthetic_count_confirmed:true,
      scanner_open_cancel_no_autosave:true,
    },
    evidence_refs:['evidence-1'],
    defects:[],
    notes:'Synthetic QA smoke.',
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
  const i={...candidate('ios',10010),...(overrides.ios??{})}
  const p={
    product:'INVEN3', gate:'F10A_PLATFORM_PARITY', status:'READY_FOR_BETA_SMOKE', version:'1.0.0',
    environment:'qa', channel:'beta', commit:sha, productionLocked:true, webBundleSha256:webHash,
    platforms:{
      android:{build:a.build,nativeBuildNumber:a.nativeBuildNumber,nativeWebVerification:a.nativeWebVerification,artifacts:a.artifacts},
      ios:{build:i.build,nativeBuildNumber:i.nativeBuildNumber,nativeWebVerification:i.nativeWebVerification,artifacts:i.artifacts},
    },
    ...(overrides.parity??{})
  }
  const as={...smoke('android',10010),...(overrides.androidSmoke??{})}
  const is={...smoke('ios',10010),...(overrides.iosSmoke??{})}
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
    expect(closure.android.sourceCandidateArtifactPath).toBe('INVEN3-android-lab.apk')
    expect(closure.ios.sourceCandidateArtifactPath).toBe('INVEN3-ios-unsigned.ipa')
    expect(closure.android.nativeWebEvidenceSha256).toBe('7'.repeat(64))
    expect(closure.ios.nativeWebEvidenceSha256).toBe('8'.repeat(64))
  })

  test('rejects candidates with different build identities',()=>{
    const dir=temp(); write(dir,{ios:{build:`${sha.slice(0,8)}.11`}})
    const result=run(dir)
    expect(result.ok).toBe(false)
    expect(result.status).toBe(108)
    expect(result.stderr).toContain('candidate mismatch: build')
  })

  test('rejects candidates with different native build numbers',()=>{
    const dir=temp(); write(dir,{ios:{nativeBuildNumber:10011},iosSmoke:{native_build_number:10011}})
    const result=run(dir)
    expect(result.ok).toBe(false)
    expect(result.status).toBe(108)
    expect(result.stderr).toContain('candidate mismatch: nativeBuildNumber')
  })

  test('rejects a failed iOS smoke',()=>{
    const dir=temp(); write(dir,{iosSmoke:{status:'FAIL'}})
    const result=run(dir)
    expect(result.ok).toBe(false)
    expect(result.status).toBe(103)
  })

  test('rejects PASS smoke with incomplete required checks',()=>{
    const dir=temp(); write(dir,{androidSmoke:{checks:{}}})
    const result=run(dir)
    expect(result.ok).toBe(false)
    expect(result.status).toBe(115)
    expect(result.stderr).toContain('failed full schema validation')
  })

  test('rejects smoke built from another candidate SHA',()=>{
    const dir=temp(); write(dir,{androidSmoke:{candidate_sha:'c'.repeat(40)}})
    const result=run(dir)
    expect(result.ok).toBe(false)
    expect(result.status).toBe(110)
  })

  test('rejects smoke whose source artifact is absent from candidate evidence',()=>{
    const dir=temp(); write(dir,{iosSmoke:{source_candidate_artifact_sha256:'f'.repeat(64)}})
    const result=run(dir)
    expect(result.ok).toBe(false)
    expect(result.status).toBe(118)
    expect(result.stderr).toContain('source artifact hash is not present')
  })

  test('rejects an Android AAB as the installed smoke source',()=>{
    const dir=temp(); write(dir,{androidSmoke:{source_candidate_artifact_sha256:'9'.repeat(64),installed_artifact_sha256:'9'.repeat(64)}})
    const result=run(dir)
    expect(result.ok).toBe(false)
    expect(result.status).toBe(119)
    expect(result.stderr).toContain('source artifact must be an APK')
  })

  test('rejects iOS re-sign evidence when the installed hash did not change',()=>{
    const dir=temp(); write(dir,{iosSmoke:{installed_artifact_sha256:'d'.repeat(64)}})
    const result=run(dir)
    expect(result.ok).toBe(false)
    expect(result.status).toBe(115)
    expect(result.stderr).toContain('RESIGNED_ARTIFACT_HASH_UNCHANGED')
  })

  test('rejects candidate evidence without native web parity',()=>{
    const dir=temp(); write(dir,{android:{nativeWebVerification:null}})
    const result=run(dir)
    expect(result.ok).toBe(false)
    expect(result.status).toBe(116)
    expect(result.stderr).toContain('native web parity evidence invalid')
  })

  test('rejects parity with changed native web evidence',()=>{
    const dir=temp()
    const changed={
      gate:'F10A_NATIVE_WEB_PARITY',
      status:'PASS',
      platform:'ios',
      verifiedFileCount:2,
      webBundleSha256:webHash,
      evidencePath:'INVEN3-ios-native-web-evidence.json',
      evidenceSha256:'f'.repeat(64),
    }
    write(dir,{parity:{platforms:{
      android:{build:`${sha.slice(0,8)}.10`,nativeBuildNumber:10010,nativeWebVerification:candidate('android',10010).nativeWebVerification,artifacts:candidate('android',10010).artifacts},
      ios:{build:`${sha.slice(0,8)}.10`,nativeBuildNumber:10010,nativeWebVerification:changed,artifacts:candidate('ios',10010).artifacts},
    }}})
    const result=run(dir)
    expect(result.ok).toBe(false)
    expect(result.status).toBe(117)
    expect(result.stderr).toContain('native web evidence mismatch')
  })

  test('rejects candidate evidence without artifact hashes',()=>{
    const dir=temp(); write(dir,{android:{artifacts:[]}})
    const result=run(dir)
    expect(result.ok).toBe(false)
    expect(result.status).toBe(116)
    expect(result.stderr).toContain('artifact evidence invalid')
  })

  test('rejects parity without platform evidence',()=>{
    const dir=temp(); write(dir,{parity:{platforms:{}}})
    const result=run(dir)
    expect(result.ok).toBe(false)
    expect(result.status).toBe(117)
    expect(result.stderr).toContain('parity android build mismatch')
  })

  test('rejects closure when production lock is disabled',()=>{
    const dir=temp()
    fs.writeFileSync(path.join(dir,'release-policy.json'),JSON.stringify({product:'INVEN3',releaseVersion:'1.0.0',productionLocked:false}))
    write(dir)
    const result=run(dir)
    expect(result.ok).toBe(false)
    expect(result.status).toBe(94)
  })
})
