import { _android as android } from 'playwright'
import { spawnSync } from 'node:child_process'
import { existsSync, mkdirSync, writeFileSync } from 'node:fs'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const PACKAGE = 'com.lockowom.inven3'
const COMPONENT = 'com.lockowom.inven3/.MainActivity'
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

async function connectDevice() {
  const devices = await android.devices()
  if (devices.length !== 1) throw new Error(`Playwright requiere exactamente 1 Android; encontrados: ${devices.length}`)
  devices[0].setDefaultTimeout(30000)
  return devices[0]
}

async function launchWebView(device) {
  await device.shell(`am force-stop ${PACKAGE}`)
  await device.shell(`am start -n ${COMPONENT}`)
  const webview = await device.webView({ pkg: PACKAGE }, { timeout: 60000 })
  const page = await webview.page()
  await page.waitForLoadState('domcontentloaded')
  return { webview, page }
}

async function screenshot(device, name) {
  await device.screenshot({ path: join(EVIDENCE_DIR, `${name}.png`) })
}

async function healthSection(page) {
  const heading = page.getByRole('heading', { name: 'HEALTH CHECK DEL DISPOSITIVO' })
  await heading.waitFor({ state: 'visible', timeout: 30000 })
  return page.locator('section').filter({ has: heading }).first()
}

async function refreshHealth(page) {
  const section = await healthSection(page)
  const button = section.getByRole('button', { name: 'ACTUALIZAR' })
  if (await button.count()) {
    await button.first().click()
    await page.waitForTimeout(1200)
  }
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

  await fieldInput(section, 'UBICACION').fill('A-01-03')
  const code = fieldInput(section, 'CODIGO')
  await code.fill('001234')
  await code.press('Tab')
  await page.waitForTimeout(500)
  const quantity = fieldInput(section, 'Cantidad Contada')
  if (await quantity.isEnabled()) await quantity.fill('1')

  const save = section.getByRole('button', { name: 'GUARDAR CONTEO' })
  if (!(await save.isEnabled())) throw new Error('GUARDAR CONTEO está bloqueado antes de crear el PENDING.')
  await save.click()
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

async function scannerCancelCheck(device, page) {
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
    const webview = await device.webView({ pkg: PACKAGE }, { timeout: 30000 })
    activePage = await webview.page()
  }
  const currentSection = activePage.locator('section.counting-screen')
  const afterItems = await currentSection.locator('.my-counts li').count()
  if (afterItems !== beforeItems) throw new Error(`Cancelar scanner cambió conteos: ${beforeItems} -> ${afterItems}`)
  return activePage
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

let device
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

  device = await connectDevice()
  let launched = await launchWebView(device)
  await refreshHealth(launched.page)
  await assertReadyOffline(launched.page)
  check('READY_OFFLINE', 'PASS')
  await screenshot(device, '01-ready-offline')

  const created = await createPending(launched.page)
  check('CREATE_PENDING', 'PASS', `${created.before} -> ${created.after}`)
  await screenshot(device, '02-pending-created')

  await device.close()
  runAdb(['shell', 'am', 'force-stop', PACKAGE])
  runAdb(['shell', 'am', 'start', '-n', COMPONENT])
  device = await connectDevice()
  launched = await launchWebView(device)
  await assertReadyOffline(launched.page)
  await assertOutstanding(launched.page)
  check('PROCESS_RESTART_PERSISTENCE', 'PASS')
  await screenshot(device, '03-after-process-restart')

  await device.close()
  device = undefined
  console.log('Reiniciando físicamente Android por ADB…')
  runAdb(['reboot'], { allowFailure: true, timeout: 10000 })
  waitForBoot()
  runAdb(['shell', 'wm', 'dismiss-keyguard'], { allowFailure: true })
  runAdb(['shell', 'am', 'start', '-n', COMPONENT], { allowFailure: true })
  device = await connectDevice()
  launched = await launchWebView(device)
  await assertReadyOffline(launched.page)
  await assertOutstanding(launched.page)
  check('PHYSICAL_REBOOT_PERSISTENCE', 'PASS')
  await screenshot(device, '04-after-device-reboot')

  const keyboard = await keyboardCheck(launched.page)
  check('KEYBOARD_LAYOUT', 'PASS', JSON.stringify(keyboard))
  await screenshot(device, '05-keyboard-layout')

  const portrait = await assertNoHorizontalOverflow(launched.page, 'PORTRAIT')
  check('PORTRAIT_OVERFLOW', 'PASS', JSON.stringify(portrait))
  const landscape = await orientationCheck(launched.page)
  check('LANDSCAPE_OVERFLOW', 'PASS', JSON.stringify(landscape))

  if (!setAirplane(false)) throw new Error('No fue posible desactivar modo avión por ADB para sincronizar.')
  if (originalWifi === '1') runAdb(['shell', 'svc', 'wifi', 'enable'], { allowFailure: true })
  await launched.page.waitForTimeout(12000)
  await syncOutstanding(launched.page)
  check('POST_REBOOT_SYNC', 'PASS')
  await screenshot(device, '06-synced')

  launched.page = await scannerCancelCheck(device, launched.page)
  check('SCANNER_CANCEL_NO_AUTOSAVE', 'PASS')
  await screenshot(device, '07-scanner-cancelled')

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
  try { if (device) await device.close() } catch {}
  saveEvidence()
  console.log(`Evidencia: ${EVIDENCE_DIR}`)
}
