import { chromium } from 'playwright'
import { spawnSync } from 'node:child_process'
import { existsSync, mkdirSync, writeFileSync } from 'node:fs'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const PACKAGE = 'com.lockowom.inven3'
const COMPONENT = 'com.lockowom.inven3/.MainActivity'
const CDP_PORT = 9223
const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const RUN_ID = new Date().toISOString().replace(/[:.]/g, '-')
const EVIDENCE_DIR = join(ROOT, 'artifacts', 'f9b-android-device', RUN_ID)
mkdirSync(EVIDENCE_DIR, { recursive: true })

const adb = process.env.LOCALAPPDATA
  ? join(process.env.LOCALAPPDATA, 'Android', 'Sdk', 'platform-tools', 'adb.exe')
  : 'adb'

if (adb.endsWith('.exe') && !existsSync(adb)) throw new Error(`ADB no encontrado en ${adb}`)

const evidence = {
  runId: RUN_ID,
  startedAt: new Date().toISOString(),
  package: PACKAGE,
  device: {},
  original: {},
  checks: [],
}

function runAdb(args, { allowFailure = false, timeout = 120000 } = {}) {
  const result = spawnSync(adb, args, { encoding: 'utf8', timeout })
  const stdout = (result.stdout ?? '').trim()
  const stderr = (result.stderr ?? '').trim()
  if (!allowFailure && (result.status !== 0 || result.error)) {
    throw new Error(`ADB ${args.join(' ')} falló: ${stderr || stdout || result.error?.message || result.status}`)
  }
  return { status: result.status ?? -1, stdout, stderr }
}

function check(name, status, detail = '') {
  evidence.checks.push({ name, status, detail, at: new Date().toISOString() })
  console.log(`[${status}] ${name}${detail ? `: ${detail}` : ''}`)
}

function saveEvidence() {
  evidence.finishedAt = new Date().toISOString()
  writeFileSync(join(EVIDENCE_DIR, 'evidence.json'), JSON.stringify(evidence, null, 2))
}

function oneConnectedSerial() {
  const lines = runAdb(['devices']).stdout.split(/\r?\n/).slice(1).filter(Boolean)
  const devices = lines.filter((line) => /\tdevice$/.test(line))
  if (devices.length !== 1) throw new Error(`Se requiere exactamente 1 dispositivo ADB; encontrados: ${devices.length}`)
  return devices[0].split(/\s+/)[0]
}

function getSetting(namespace, key) {
  return runAdb(['shell', 'settings', 'get', namespace, key], { allowFailure: true }).stdout
}

function setSetting(namespace, key, value) {
  runAdb(['shell', 'settings', 'put', namespace, key, String(value)], { allowFailure: true })
}

function airplaneState() {
  return getSetting('global', 'airplane_mode_on') === '1'
}

function setAirplane(enabled) {
  const desired = enabled ? 'enable' : 'disable'
  runAdb(['shell', 'cmd', 'connectivity', 'airplane-mode', desired], { allowFailure: true })
  if (airplaneState() !== enabled) {
    runAdb(['shell', 'settings', 'put', 'global', 'airplane_mode_on', enabled ? '1' : '0'], { allowFailure: true })
    runAdb(['shell', 'am', 'broadcast', '-a', 'android.intent.action.AIRPLANE_MODE', '--ez', 'state', enabled ? 'true' : 'false'], { allowFailure: true })
  }
  return airplaneState() === enabled
}

function waitForBoot() {
  runAdb(['wait-for-device'], { timeout: 180000 })
  const deadline = Date.now() + 180000
  while (Date.now() < deadline) {
    const completed = runAdb(['shell', 'getprop', 'sys.boot_completed'], { allowFailure: true, timeout: 10000 }).stdout
    if (completed === '1') return
    Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, 2000)
  }
  throw new Error('Android no completó el boot dentro de 180 s.')
}

function isUserUnlocked() {
  const direct = runAdb(['shell', 'cmd', 'user', 'is-user-unlocked', '0'], { allowFailure: true, timeout: 10000 }).stdout.trim().toLowerCase()
  if (direct === 'true') return true
  if (direct === 'false') return false

  const dump = runAdb(['shell', 'dumpsys', 'user'], { allowFailure: true, timeout: 15000 }).stdout
  return /RUNNING_UNLOCKED|unlocked\s*=\s*true|State:\s*RUNNING_UNLOCKED/i.test(dump)
}

function waitForUserUnlock() {
  const deadline = Date.now() + 240000
  if (isUserUnlocked()) {
    console.log('[INFO] Usuario Android ya está desbloqueado después del reboot.')
    return
  }

  console.log('')
  console.log('============================================================')
  console.log(' ACCIÓN FÍSICA ÚNICA REQUERIDA')
  console.log(' Desbloquea el Xiaomi una vez con tu PIN/huella.')
  console.log(' Android mantiene SQLite credential-encrypted hasta ese paso.')
  console.log(' El runner continuará automáticamente cuando detecte UNLOCKED.')
  console.log('============================================================')
  console.log('')

  while (Date.now() < deadline) {
    runAdb(['shell', 'input', 'keyevent', '224'], { allowFailure: true, timeout: 10000 })
    if (isUserUnlocked()) {
      console.log('[PASS] USER_UNLOCKED: almacenamiento de usuario disponible.')
      return
    }
    Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, 2000)
  }

  throw new Error('El usuario Android no fue desbloqueado dentro de 240 s después del reboot.')
}

async function startAppAndWaitForPid({ forceStop = true, timeoutMs = 45000 } = {}) {
  if (forceStop) runAdb(['shell', 'am', 'force-stop', PACKAGE], { allowFailure: true, timeout: 10000 })

  const deadline = Date.now() + timeoutMs
  let lastStart = ''
  while (Date.now() < deadline) {
    const pid = runAdb(['shell', 'pidof', PACKAGE], { allowFailure: true, timeout: 10000 }).stdout.split(/\s+/)[0]
    if (pid) return pid

    const start = runAdb(['shell', 'am', 'start', '-W', '-n', COMPONENT], { allowFailure: true, timeout: 20000 })
    lastStart = [start.stdout, start.stderr].filter(Boolean).join(' | ')
    await sleep(1200)
  }

  const users = runAdb(['shell', 'dumpsys', 'user'], { allowFailure: true, timeout: 15000 }).stdout
  throw new Error(`INVEN3 no obtuvo PID después de ${timeoutMs} ms. Último am start: ${lastStart || 'sin salida'}. Usuario desbloqueado=${isUserUnlocked()}. dumpsys user=${users.slice(0, 1200)}`)
}

function stage(name) {
  console.log(`[STAGE] ${name}`)
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms))
}

async function withTimeout(promise, ms, label) {
  let timer
  try {
    return await Promise.race([
      promise,
      new Promise((_, reject) => {
        timer = setTimeout(() => reject(new Error(`${label} excedió ${ms} ms`)), ms)
      }),
    ])
  } finally {
    clearTimeout(timer)
  }
}

async function findWebViewSocket(timeoutMs = 30000) {
  const deadline = Date.now() + timeoutMs
  let lastPid = null
  let lastCandidates = []

  while (Date.now() < deadline) {
    const pid = runAdb(['shell', 'pidof', PACKAGE], { allowFailure: true, timeout: 10000 }).stdout.split(/\s+/)[0]
    lastPid = pid || null
    if (pid) {
      const sockets = runAdb(['shell', 'cat', '/proc/net/unix'], { allowFailure: true, timeout: 10000 }).stdout
      const candidates = sockets
        .split(/\r?\n/)
        .map((line) => line.match(/@?(webview_devtools_remote[^\s]*)/)?.[1])
        .filter(Boolean)
      lastCandidates = candidates
      const preferred = candidates.find((socket) => socket.includes(pid)) ?? (candidates.length === 1 ? candidates[0] : null)
      if (preferred) return { pid, socket: preferred }
    }
    await sleep(500)
  }

  throw new Error(`WebView DevTools no apareció en ${timeoutMs} ms. pid=${lastPid ?? 'none'} sockets=${JSON.stringify(lastCandidates)}`)
}

async function connectWebView({ restartApp = true } = {}) {
  stage(restartApp ? 'Iniciando INVEN3 y conectando WebView por CDP' : 'Reconectando WebView por CDP')
  if (restartApp) {
    await startAppAndWaitForPid({ forceStop: true })
  } else {
    const existingPid = runAdb(['shell', 'pidof', PACKAGE], { allowFailure: true, timeout: 10000 }).stdout.split(/\s+/)[0]
    if (!existingPid) await startAppAndWaitForPid({ forceStop: false })
  }
  await sleep(800)

  const { pid, socket } = await findWebViewSocket()
  runAdb(['forward', '--remove', `tcp:${CDP_PORT}`], { allowFailure: true, timeout: 10000 })
  runAdb(['forward', `tcp:${CDP_PORT}`, `localabstract:${socket}`], { timeout: 10000 })

  const browser = await withTimeout(
    chromium.connectOverCDP(`http://127.0.0.1:${CDP_PORT}`),
    20000,
    'Conexión CDP al WebView',
  )
  const context = browser.contexts()[0]
  if (!context) throw new Error('CDP conectado pero sin BrowserContext.')
  let pages = context.pages()
  if (!pages.length) {
    await sleep(1000)
    pages = context.pages()
  }
  const page = pages[0]
  if (!page) throw new Error('CDP conectado pero sin página WebView.')
  page.setDefaultTimeout(30000)
  await withTimeout(page.waitForLoadState('domcontentloaded'), 20000, 'Carga del WebView')
  console.log(`[CDP] pid=${pid} socket=${socket} url=${page.url()}`)
  return { browser, page }
}

async function screenshot(_unused, name) {
  const remote = `/sdcard/${name}.png`
  runAdb(['shell', 'screencap', '-p', remote], { allowFailure: true, timeout: 15000 })
  runAdb(['pull', remote, join(EVIDENCE_DIR, `${name}.png`)], { allowFailure: true, timeout: 30000 })
  runAdb(['shell', 'rm', '-f', remote], { allowFailure: true, timeout: 10000 })
}

async function healthSection(page) {
  const heading = page.getByRole('heading', { name: 'HEALTH CHECK DEL DISPOSITIVO' })
  await heading.waitFor({ state: 'visible', timeout: 30000 })
  return page.locator('section').filter({ has: heading }).first()
}

async function ensureHealthReady(page) {
  const section = await healthSection(page)
  const readyOffline = page.getByText('DISPOSITIVO LISTO PARA INVENTARIO OFFLINE', { exact: false })
  const refresh = section.getByRole('button', { name: 'ACTUALIZAR' }).first()
  const deadline = Date.now() + 45000

  stage('Esperando Health Check automático de arranque')
  while (Date.now() < deadline) {
    if (await readyOffline.isVisible().catch(() => false)) {
      console.log('[INFO] Health Check inicial ya resolvió READY_OFFLINE; no se fuerza ACTUALIZAR.')
      return
    }

    const enabled = await refresh.isEnabled().catch(() => false)
    if (enabled) {
      console.log('[INFO] Health Check inicial terminó sin READY_OFFLINE; ejecutando ACTUALIZAR una vez.')
      await refresh.click({ timeout: 10000 })
      return
    }

    await page.waitForTimeout(500)
  }

  const status = await section.locator('.device-health-overall').textContent().catch(() => null)
  throw new Error(`Health Check inicial no terminó en 45 s. Estado visible: ${status ?? 'desconocido'}`)
}

async function assertReadyOffline(page) {
  await page.getByText('DISPOSITIVO LISTO PARA INVENTARIO OFFLINE', { exact: false }).waitFor({ state: 'visible', timeout: 30000 })
  const section = await healthSection(page)
  for (const label of ['Usuario', 'Inventario', 'Maestro SKU', 'Base local']) {
    const card = section.locator('div').filter({ hasText: new RegExp(`^${label}`) }).first()
    await card.getByText('PASS', { exact: true }).waitFor({ state: 'visible', timeout: 10000 })
  }
}

function fieldInput(section, label) {
  return section.locator('label.field').filter({ hasText: new RegExp(`^${label}`) }).locator('input').first()
}

async function outstandingCount(section) {
  return section.locator('.my-counts li').filter({ hasText: /Pendiente de sincronización|Pendiente de reintento|Sincronizando/ }).count()
}

async function createPending(page) {
  const section = page.locator('section.counting-screen')
  await section.getByRole('heading', { name: 'CONTEO FÍSICO' }).waitFor({ state: 'visible' })
  const before = await outstandingCount(section)

  const location = fieldInput(section, 'UBICACION')
  const code = fieldInput(section, 'CODIGO')
  const quantity = fieldInput(section, 'Cantidad Contada')
  const save = section.getByRole('button', { name: 'GUARDAR CONTEO' })

  await location.waitFor({ state: 'visible', timeout: 30000 })
  await withTimeout((async () => {
    while (!(await location.isEnabled().catch(() => false))) await page.waitForTimeout(250)
  })(), 30000, 'Habilitación del formulario de conteo')

  await location.fill('A-01-03')
  await code.fill('001234')

  // React resolves the local master on CODIGO onBlur. Android WebView does not
  // reliably synthesize that lifecycle from a Tab key, so force a real blur
  // and move focus to the next stable field.
  await code.blur().catch(() => {})
  await code.evaluate((input) => input.blur()).catch(() => {})
  await location.focus().catch(() => {})

  const descriptionField = section.locator('label.field').filter({ hasText: /^DESCRIPCION/ }).locator('textarea')
  stage('Esperando resolución local del SKU 001234')
  try {
    await withTimeout((async () => {
      while (true) {
        const description = await descriptionField.inputValue().catch(() => '')
        if (description.trim()) return
        await page.waitForTimeout(250)
      }
    })(), 15000, 'Resolución local del SKU 001234')
  } catch (error) {
    const diagnostic = {
      codigo: await code.inputValue().catch(() => null),
      descripcion: await descriptionField.inputValue().catch(() => null),
      errores: await section.locator('.form-error').allTextContents().catch(() => []),
      estados: await section.locator('[role="status"]').allTextContents().catch(() => []),
      guardarDisabled: await save.isDisabled().catch(() => null),
    }
    throw new Error(`SKU 001234 no resolvió. Diagnóstico: ${JSON.stringify(diagnostic)}. Causa: ${error instanceof Error ? error.message : String(error)}`)
  }

  stage('Esperando capacidad local y habilitación de GUARDAR')
  try {
    await withTimeout((async () => {
      while (!(await save.isEnabled().catch(() => false))) await page.waitForTimeout(250)
    })(), 15000, 'Habilitación de GUARDAR')
  } catch (error) {
    const diagnostic = {
      descripcion: await descriptionField.inputValue().catch(() => null),
      errores: await section.locator('.form-error').allTextContents().catch(() => []),
      warnings: await section.locator('.form-warning').allTextContents().catch(() => []),
      estados: await section.locator('[role="status"]').allTextContents().catch(() => []),
      guardarDisabled: await save.isDisabled().catch(() => null),
    }
    throw new Error(`GUARDAR no se habilitó. Diagnóstico: ${JSON.stringify(diagnostic)}. Causa: ${error instanceof Error ? error.message : String(error)}`)
  }

  if (await quantity.isEnabled()) await quantity.fill('1')

  const state = await save.evaluate((button) => {
    const rect = button.getBoundingClientRect()
    return {
      disabled: button.disabled,
      text: button.textContent,
      rect: { top: rect.top, bottom: rect.bottom, left: rect.left, right: rect.right, width: rect.width, height: rect.height },
      viewport: { width: window.innerWidth, height: window.innerHeight, scrollY: window.scrollY },
    }
  })
  console.log('[INFO] Estado GUARDAR antes del click:', JSON.stringify(state))
  if (state.disabled) throw new Error(`GUARDAR CONTEO sigue deshabilitado: ${JSON.stringify(state)}`)

  await save.scrollIntoViewIfNeeded().catch(() => {})
  await page.waitForTimeout(300)

  const clickable = await save.isVisible().catch(() => false)
  if (clickable) {
    try {
      await save.click({ timeout: 8000 })
    } catch (error) {
      console.log('[WARN] Click Playwright falló; usando click DOM nativo:', error instanceof Error ? error.message : String(error))
      await save.evaluate((button) => button.click())
    }
  } else {
    console.log('[WARN] GUARDAR no es visible para Playwright; usando click DOM nativo.')
    await save.evaluate((button) => button.click())
  }

  await section.getByText('CONTEO GUARDADO', { exact: true }).waitFor({ state: 'visible', timeout: 15000 })

  const deadline = Date.now() + 15000
  while (Date.now() < deadline) {
    const after = await outstandingCount(section)
    if (after > before) return { before, after }
    await page.waitForTimeout(500)
  }
  throw new Error('El conteo no quedó outstanding localmente.')
}

async function assertOutstanding(page) {
  const section = page.locator('section.counting-screen')
  await section.getByRole('heading', { name: 'MIS CONTEOS' }).waitFor({ state: 'visible', timeout: 30000 })
  const pending = section.locator('.my-counts li').filter({ hasText: /Pendiente de sincronización|Pendiente de reintento|Sincronizando/ })
  if ((await pending.count()) < 1) throw new Error('No existe conteo outstanding después de reiniciar.')
}

async function assertNoHorizontalOverflow(page, name) {
  const metrics = await page.evaluate(() => ({
    scrollWidth: document.documentElement.scrollWidth,
    innerWidth: window.innerWidth,
    visualWidth: window.visualViewport?.width ?? window.innerWidth,
  }))
  if (metrics.scrollWidth > Math.ceil(metrics.innerWidth) + 1) throw new Error(`${name}: overflow horizontal ${JSON.stringify(metrics)}`)
  return metrics
}

async function keyboardCheck(page) {
  const section = page.locator('section.counting-screen')
  const code = fieldInput(section, 'CODIGO')
  await code.focus()
  await page.waitForTimeout(700)
  const before = await page.evaluate(() => ({ innerHeight: window.innerHeight, visualHeight: window.visualViewport?.height ?? window.innerHeight }))
  const save = section.getByRole('button', { name: 'GUARDAR CONTEO' })
  await save.scrollIntoViewIfNeeded()
  const visible = await save.evaluate((el) => {
    const rect = el.getBoundingClientRect()
    const height = window.visualViewport?.height ?? window.innerHeight
    return rect.top < height && rect.bottom > 0
  })
  if (!visible) throw new Error('GUARDAR CONTEO no es alcanzable con teclado abierto.')
  runAdb(['shell', 'input', 'keyevent', '4'], { allowFailure: true })
  return before
}

async function syncOutstanding(page) {
  const section = page.locator('section.counting-screen')
  const button = section.getByRole('button', { name: 'SINCRONIZAR AHORA' }).first()
  await button.click()
  const deadline = Date.now() + 45000
  while (Date.now() < deadline) {
    const pending = await outstandingCount(section)
    if (pending === 0) {
      await section.getByText('Confirmado en servidor', { exact: true }).first().waitFor({ state: 'visible', timeout: 5000 })
      return
    }
    await page.waitForTimeout(1000)
  }
  throw new Error('La sincronización no confirmó todos los outstanding dentro de 45 s.')
}

async function scannerCancelCheck(browser, page) {
  const section = page.locator('section.counting-screen')
  const beforeItems = await section.locator('.my-counts li').count()
  const scan = section.getByRole('button', { name: 'Escanear codigo' })
  if (!(await scan.isEnabled())) throw new Error('Scanner CODIGO no está habilitado.')
  await scan.click()
  await new Promise((resolve) => setTimeout(resolve, 2500))
  runAdb(['shell', 'input', 'keyevent', '4'], { allowFailure: true })
  await new Promise((resolve) => setTimeout(resolve, 1500))
  let activePage = page
  if (page.isClosed()) {
    try { await browser.close() } catch {}
    const reconnected = await connectWebView({ restartApp: false })
    browser = reconnected.browser
    activePage = reconnected.page
  }
  const currentSection = activePage.locator('section.counting-screen')
  const afterItems = await currentSection.locator('.my-counts li').count()
  if (afterItems !== beforeItems) throw new Error(`Cancelar scanner cambió conteos: ${beforeItems} -> ${afterItems}`)
  return { browser, page: activePage }
}

async function orientationCheck(page) {
  const originalAccel = getSetting('system', 'accelerometer_rotation')
  const originalRotation = getSetting('system', 'user_rotation')
  evidence.original.accelerometerRotation = originalAccel
  evidence.original.userRotation = originalRotation
  try {
    setSetting('system', 'accelerometer_rotation', '0')
    setSetting('system', 'user_rotation', '1')
    await page.waitForTimeout(1800)
    return await assertNoHorizontalOverflow(page, 'LANDSCAPE')
  } finally {
    if (originalAccel) setSetting('system', 'accelerometer_rotation', originalAccel)
    if (originalRotation) setSetting('system', 'user_rotation', originalRotation)
    await page.waitForTimeout(1200)
  }
}

let browser
let originalAirplane
let originalWifi
try {
  const serial = oneConnectedSerial()
  evidence.device.serial = serial
  evidence.device.model = runAdb(['shell', 'getprop', 'ro.product.model']).stdout
  evidence.device.manufacturer = runAdb(['shell', 'getprop', 'ro.product.manufacturer']).stdout
  evidence.device.sdk = runAdb(['shell', 'getprop', 'ro.build.version.sdk']).stdout
  originalAirplane = airplaneState()
  originalWifi = getSetting('global', 'wifi_on')
  evidence.original.airplaneMode = originalAirplane
  evidence.original.wifiOn = originalWifi
  console.log(`Dispositivo: ${evidence.device.manufacturer} ${evidence.device.model} / ${serial}`)

  if (!setAirplane(true)) throw new Error('No fue posible activar modo avión por ADB. Actívelo manualmente y vuelva a ejecutar.')
  runAdb(['shell', 'svc', 'wifi', 'disable'], { allowFailure: true })
  check('AIRPLANE_MODE', 'PASS', 'Modo avión activo y Wi-Fi deshabilitado.')

  stage('Conectando a INVEN3 offline')
  let launched = await connectWebView()
  browser = launched.browser
  await ensureHealthReady(launched.page)
  await assertReadyOffline(launched.page)
  check('READY_OFFLINE', 'PASS')
  await screenshot(null, '01-ready-offline')

  stage('Creando conteo offline sintético')
  const created = await createPending(launched.page)
  check('CREATE_PENDING', 'PASS', `${created.before} -> ${created.after}`)
  await screenshot(null, '02-pending-created')

  stage('Probando persistencia tras cierre/reapertura de proceso')
  try { await browser.close() } catch {}
  runAdb(['forward', '--remove', `tcp:${CDP_PORT}`], { allowFailure: true })
  launched = await connectWebView()
  browser = launched.browser
  await assertReadyOffline(launched.page)
  await assertOutstanding(launched.page)
  check('PROCESS_RESTART_PERSISTENCE', 'PASS')
  await screenshot(null, '03-after-process-restart')

  try { await browser.close() } catch {}
  browser = undefined
  runAdb(['forward', '--remove', `tcp:${CDP_PORT}`], { allowFailure: true })
  stage('Reiniciando físicamente Android por ADB')
  console.log('El teléfono puede tardar hasta 3 minutos en volver a estar disponible…')
  runAdb(['reboot'], { allowFailure: true, timeout: 10000 })
  waitForBoot()
  stage('Esperando primer desbloqueo del usuario después del reboot')
  waitForUserUnlock()

  // HyperOS can restore radios asynchronously after boot. Reassert the
  // certification network state before starting INVEN3.
  if (!setAirplane(true)) throw new Error('Modo avión no pudo restablecerse después del reboot.')
  runAdb(['shell', 'svc', 'wifi', 'disable'], { allowFailure: true })
  check('AIRPLANE_MODE_POST_REBOOT', 'PASS')

  runAdb(['shell', 'wm', 'dismiss-keyguard'], { allowFailure: true })
  await startAppAndWaitForPid({ forceStop: false })
  launched = await connectWebView({ restartApp: false })
  browser = launched.browser
  await assertReadyOffline(launched.page)
  await assertOutstanding(launched.page)
  check('PHYSICAL_REBOOT_PERSISTENCE', 'PASS')
  await screenshot(null, '04-after-device-reboot')

  stage('Validando teclado y layout móvil')
  const keyboard = await keyboardCheck(launched.page)
  check('KEYBOARD_LAYOUT', 'PASS', JSON.stringify(keyboard))
  await screenshot(null, '05-keyboard-layout')

  const portrait = await assertNoHorizontalOverflow(launched.page, 'PORTRAIT')
  check('PORTRAIT_OVERFLOW', 'PASS', JSON.stringify(portrait))
  const landscape = await orientationCheck(launched.page)
  check('LANDSCAPE_OVERFLOW', 'PASS', JSON.stringify(landscape))

  stage('Recuperando conectividad y sincronizando outstanding')
  if (!setAirplane(false)) throw new Error('No fue posible desactivar modo avión por ADB para sincronizar.')
  if (originalWifi === '1') runAdb(['shell', 'svc', 'wifi', 'enable'], { allowFailure: true })
  await launched.page.waitForTimeout(12000)
  await syncOutstanding(launched.page)
  check('POST_REBOOT_SYNC', 'PASS')
  await screenshot(null, '06-synced')

  stage('Validando apertura/cancelación del scanner sin autosave')
  const scannerResult = await scannerCancelCheck(browser, launched.page)
  browser = scannerResult.browser
  launched.page = scannerResult.page
  check('SCANNER_CANCEL_NO_AUTOSAVE', 'PASS')
  await screenshot(null, '07-scanner-cancelled')

  evidence.status = 'PASS'
} catch (error) {
  evidence.status = 'FAIL'
  evidence.error = error instanceof Error ? error.stack ?? error.message : String(error)
  check('CERTIFICATION', 'FAIL', error instanceof Error ? error.message : String(error))
  process.exitCode = 1
} finally {
  try {
    if (typeof originalAirplane === 'boolean') setAirplane(originalAirplane)
    if (originalWifi === '1') runAdb(['shell', 'svc', 'wifi', 'enable'], { allowFailure: true })
    else if (originalWifi === '0') runAdb(['shell', 'svc', 'wifi', 'disable'], { allowFailure: true })
  } catch {}
  try { if (browser) await browser.close() } catch {}
  try { runAdb(['forward', '--remove', `tcp:${CDP_PORT}`], { allowFailure: true, timeout: 10000 }) } catch {}
  saveEvidence()
  console.log(`Evidencia: ${EVIDENCE_DIR}`)
}
