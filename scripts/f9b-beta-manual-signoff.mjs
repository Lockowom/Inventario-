import { createInterface } from 'node:readline/promises'
import { stdin as input, stdout as output } from 'node:process'
import { mkdirSync, writeFileSync } from 'node:fs'
import { join, resolve, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const CANDIDATE_SHA = '2aa6645ab89c5e74dc12c9475019880aca65564f'
const APP_VERSION = 'f9b-qa-2aa6645a'
const ENVIRONMENT = 'INVEN3-QA'
const DATASET = 'INVEN3_QA_SYNTHETIC_F9B4_20260926T0535Z'

const checks = [
  ['navigation_ok', '¿Navegación básica sin bloqueo visual/operacional evidente?'],
  ['contador_save_ok', '¿CONTADOR puede guardar un conteo sintético?'],
  ['analista_supervision_ok', '¿ANALISTA puede abrir Supervisión?'],
  ['analista_cuts_ok', '¿ANALISTA puede abrir Cortes?'],
  ['no_blocker_ok', '¿No apareció ningún error BLOCKER?'],
  ['candidate_identity_ok', `¿Confirmaste build ${APP_VERSION} / candidato ${CANDIDATE_SHA.slice(0, 8)}?`],
]

function normalizeYes(value) {
  return ['s', 'si', 'sí', 'y', 'yes'].includes(value.trim().toLowerCase())
}

const rl = createInterface({ input, output })
const startedAt = new Date().toISOString()

console.log('')
console.log('F9B — BETA MANUAL SIGN-OFF')
console.log(`Entorno: ${ENVIRONMENT}`)
console.log(`Build:   ${APP_VERSION}`)
console.log(`SHA:     ${CANDIDATE_SHA}`)
console.log('Responde S/N. No pegues credenciales ni datos reales.')
console.log('')

const operator = (await rl.question('Operador/observador: ')).trim() || 'UNSPECIFIED'
const results = {}

for (const [key, question] of checks) {
  const answer = await rl.question(`${question} [S/N]: `)
  results[key] = normalizeYes(answer)
}

const notes = (await rl.question('Notas breves (opcional): ')).trim()
rl.close()

const passed = Object.values(results).every(Boolean)
const finishedAt = new Date().toISOString()
const record = {
  schema: 'inven3.f9b.beta-signoff.v1',
  execution_id: `BETA-F9B-${finishedAt.replace(/[-:.TZ]/g, '').slice(0, 14)}`,
  gate: 'BETA_MANUAL',
  status: passed ? 'PASS' : 'FAIL',
  candidate_sha: CANDIDATE_SHA,
  app_version: APP_VERSION,
  environment: ENVIRONMENT,
  dataset: DATASET,
  operator,
  started_at: startedAt,
  finished_at: finishedAt,
  checks: results,
  notes,
  production_data_used: false,
  f10_started: false,
}

const dir = join(ROOT, 'artifacts', 'f9b-beta')
mkdirSync(dir, { recursive: true })
const path = join(dir, `${record.execution_id}.json`)
writeFileSync(path, JSON.stringify(record, null, 2) + '\n')

console.log('')
console.log(`[${record.status}] BETA_MANUAL`)
console.log(`Evidencia: ${path}`)
if (!passed) process.exitCode = 2
