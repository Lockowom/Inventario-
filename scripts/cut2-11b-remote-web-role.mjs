/** CUT2-11B local Chromium -> remote QA role proof. Credentials stay in memory. */
import { execFileSync, spawn } from 'node:child_process'
import { randomUUID } from 'node:crypto'
import { chromium } from '@playwright/test'

const ref = 'kpsdephjbvkwvazxubtb'
const url = `https://${ref}.supabase.co`
const actors = {
  QA_ADMIN: 'c58318fc-4b1b-4d81-95e4-7017c0ce2b05',
  QA_ANALISTA: '321eeec7-1292-401f-97aa-7264775663d4',
  QA_CONTADOR: '6d716ad6-dd4e-4b30-93c7-2dd5a16022cb',
}
const role = process.env.C11B_ROLE
if (!Object.hasOwn(actors, role)) throw new Error('C11B_ROLE_REQUIRED')

const keyRows = JSON.parse(execFileSync('cmd.exe', ['/d', '/s', '/c', `%APPDATA%\\npm\\supabase.cmd projects api-keys --project-ref ${ref} --reveal --output json`], { encoding: 'utf8', windowsHide: true }))
const getKey = (names) => {
  const item = keyRows.find((key) => names.includes(String(key.name ?? key.key_name ?? '').toLowerCase()))
  return item?.api_key ?? item?.key ?? item?.value
}
const anon = getKey(['anon', 'publishable'])
const service = getKey(['service_role', 'secret'])
if (!anon || !service) throw new Error('QA_API_KEYS_UNAVAILABLE')

async function admin(path, options = {}) {
  const response = await fetch(`${url}${path}`, { ...options, headers: { apikey: service, Authorization: `Bearer ${service}`, 'Content-Type': 'application/json' } })
  const body = await response.text()
  if (!response.ok) throw new Error(`AUTH_ADMIN_HTTP_${response.status}`)
  return body ? JSON.parse(body) : {}
}

const password = `Qa11b-web-${randomUUID()}-K7!`
let vite = null
let browser = null
try {
  const users = (await admin('/auth/v1/admin/users?per_page=1000')).users ?? []
  const account = users.find((user) => user.id === actors[role])
  if (!account?.email) throw new Error('SYNTHETIC_ACTOR_NOT_FOUND')
  await admin(`/auth/v1/admin/users/${actors[role]}`, { method: 'PUT', body: JSON.stringify({ password, email_confirm: true }) })
  const env = { ...process.env, VITE_SUPABASE_URL: url, VITE_SUPABASE_ANON_KEY: anon, VITE_RELEASE_CHANNEL: 'QA', VITE_BUILD_TYPE: 'BETA' }
  delete env.SUPABASE_SERVICE_ROLE_KEY; delete env.VITE_SUPABASE_SERVICE_ROLE_KEY; delete env.SERVICE_ROLE_KEY
  const port = role === 'QA_ADMIN' ? '4191' : role === 'QA_ANALISTA' ? '4192' : '4193'
  vite = spawn('cmd.exe', ['/d', '/s', '/c', `npm run dev -- --host 127.0.0.1 --port ${port}`], { env, stdio: 'ignore', windowsHide: true })
  for (let attempt = 0; attempt < 100; attempt += 1) {
    try { if ((await fetch(`http://127.0.0.1:${port}`)).ok) break } catch { /* startup */ }
    if (attempt === 99) throw new Error('VITE_NOT_READY')
    await new Promise((resolve) => setTimeout(resolve, 200))
  }
  browser = await chromium.launch({ headless: true })
  const page = await browser.newPage()
  page.setDefaultTimeout(30_000)
  const externalHosts = new Set()
  page.on('request', (request) => {
    const host = new URL(request.url()).hostname
    if (host !== '127.0.0.1') externalHosts.add(host)
  })
  await page.goto(`http://127.0.0.1:${port}`, { waitUntil: 'domcontentloaded', timeout: 60_000 })
  await page.getByLabel('Correo').fill(account.email)
  await page.getByLabel('Contraseña').fill(password)
  await page.getByRole('button', { name: 'INICIAR SESIÓN' }).click()
  const landing = role === 'QA_CONTADOR' ? 'CONTEO FÍSICO' : 'CENTRO DE CONTROL DE INVENTARIO'
  try {
    await page.getByRole('heading', { name: landing }).waitFor()
  } catch (error) {
    const visible = await page.locator('body').innerText().catch(() => '')
    console.log(JSON.stringify({ role, login: 'FAILED', visible: visible.slice(0, 2000), error: error instanceof Error ? error.name : 'UNKNOWN' }))
    throw error
  }
  // One scoped ANALISTA session certifies the guarded Realtime subscription.
  // ADMIN navigation remains independent of a transient transport indicator.
  if (role === 'QA_ANALISTA') await page.getByText('● EN VIVO', { exact: true }).waitFor({ timeout: 20_000 })
  const journeys = []
  const expectedViews = role === 'QA_CONTADOR'
    ? [['Conteo', 'CONTEO FÍSICO'], ['Reconteos', 'RECONTEOS']]
    : [
      ['Conteo', 'CONTEO FÍSICO'], ['Reconteos', 'RECONTEOS'], ['Centro de Control', 'CENTRO DE CONTROL DE INVENTARIO'],
      ['Carga de datos', 'CENTRO DE CARGA'], ['Cortes', 'CORTES'], ['Liberación RP', 'LIBERACIÓN RP'], ['Maestro SKU', 'Maestro SKU'],
      ...(role === 'QA_ADMIN' ? [['Usuarios', 'USUARIOS']] : []),
    ]
  for (const [label, heading] of expectedViews) {
    await page.getByRole('button', { name: new RegExp(`^${label}`) }).click()
    await page.getByRole('heading', { name: heading, exact: true }).waitFor()
    journeys.push(label)
  }
  const snapshot = await page.evaluate(() => ({
    headings: [...document.querySelectorAll('h1,h2,h3')].map((node) => node.textContent?.trim()).filter(Boolean),
    actions: [...document.querySelectorAll('button')].map((node) => node.textContent?.trim()).filter(Boolean),
    storage: JSON.stringify({ local: Object.fromEntries(Object.entries(localStorage)), session: Object.fromEntries(Object.entries(sessionStorage)) }),
  }))
  if (snapshot.storage.includes(service)) throw new Error('SERVICE_ROLE_BROWSER_LEAK')
  if ([...externalHosts].some((host) => host !== `${ref}.supabase.co`)) throw new Error(`UNEXPECTED_BROWSER_HOST:${[...externalHosts].join(',')}`)
  const actionText = snapshot.actions.join(' ')
  if (role === 'QA_ADMIN' && !actionText.includes('Usuarios')) throw new Error('ADMIN_UI_CAPABILITY_MISSING')
  if (role === 'QA_ANALISTA' && actionText.includes('Usuarios')) throw new Error('ANALYST_GLOBAL_ADMIN_EXPOSED')
  if (role === 'QA_CONTADOR' && /Liberación RP|Usuarios|REVISAR CIERRE/.test(actionText)) throw new Error('COUNTER_PRIVILEGED_UI_EXPOSED')
  await page.getByRole('button', { name: 'CERRAR SESIÓN' }).first().click()
  await page.getByRole('button', { name: 'INICIAR SESIÓN' }).waitFor()
  console.log(JSON.stringify({ role, login: 'PASS', logout: 'PASS', journeys, externalHosts: [...externalHosts], serviceRoleInBrowser: false, headings: snapshot.headings, actions: snapshot.actions }))
} finally {
  if (browser) await browser.close().catch(() => {})
  if (vite) execFileSync('taskkill', ['/pid', String(vite.pid), '/t', '/f'], { stdio: 'ignore', windowsHide: true })
}
