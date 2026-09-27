import { webkit } from '@playwright/test'
import { spawn } from 'node:child_process'
import { mkdirSync, writeFileSync } from 'node:fs'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const viteBin = join(root, 'node_modules', 'vite', 'bin', 'vite.js')
const host = '127.0.0.1'
const port = 4173
const baseURL = `http://${host}:${port}`
const artifactDir = join(root, 'artifacts', 'ios-matrix')
mkdirSync(artifactDir, { recursive: true })

const devices = [
  ['iPhone 11',414,896,2],['iPhone 11 Pro',375,812,3],['iPhone 11 Pro Max',414,896,3],
  ['iPhone 12',390,844,3],['iPhone 12 Pro',390,844,3],['iPhone 12 Pro Max',428,926,3],
  ['iPhone 13',390,844,3],['iPhone 13 Pro',390,844,3],['iPhone 13 Pro Max',428,926,3],
  ['iPhone 14',390,844,3],['iPhone 14 Pro',393,852,3],['iPhone 14 Pro Max',430,932,3],
  ['iPhone 15',393,852,3],['iPhone 15 Pro',393,852,3],['iPhone 15 Pro Max',430,932,3],
  ['iPhone 16',393,852,3],['iPhone 16 Pro',402,874,3],['iPhone 16 Pro Max',440,956,3],
  ['iPhone 17',402,874,3],['iPhone 17 Pro',402,874,3],['iPhone 17 Pro Max',440,956,3],
  ['iPhone 18 Pro',402,874,3],['iPhone 18 Pro Max',440,956,3],
]

const ua = 'Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.0 Mobile/15E148 Safari/604.1'
const server = spawn(process.execPath, [viteBin, '--host', host, '--port', String(port)], {
  cwd: root,
  env: { ...process.env, VITE_CERTIFICATION_FIXTURE: '1' },
  stdio: ['ignore', 'pipe', 'pipe'],
})
server.stdout.on('data', (chunk) => process.stdout.write(`[vite] ${chunk}`))
server.stderr.on('data', (chunk) => process.stderr.write(`[vite] ${chunk}`))

async function waitForServer() {
  const deadline = Date.now() + 30_000
  while (Date.now() < deadline) {
    try { if ((await fetch(baseURL)).ok) return } catch {}
    await new Promise((resolve) => setTimeout(resolve, 250))
  }
  throw new Error('Vite no quedó disponible en 30 segundos.')
}

function slug(value) {
  return value.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '')
}

const results = []
let browser
try {
  await waitForServer()
  browser = await webkit.launch({ headless: true })

  for (const [name,width,height,dpr] of devices) {
    const context = await browser.newContext({
      viewport: { width, height },
      screen: { width, height },
      deviceScaleFactor: dpr,
      isMobile: true,
      hasTouch: true,
      userAgent: ua,
      locale: 'es-CL',
      colorScheme: 'dark',
    })
    const page = await context.newPage()

    const checks = {}
    await page.goto(`${baseURL}/?fixture=health-ready&iosMatrixCert=1&model=${encodeURIComponent(name)}`, { waitUntil: 'networkidle' })
    checks.healthVisible = await page.getByText('HEALTH CHECK DEL DISPOSITIVO', { exact: true }).first().isVisible().catch(() => false)
    const healthMetrics = await page.evaluate(() => ({
      width: innerWidth,
      height: innerHeight,
      scrollWidth: document.documentElement.scrollWidth,
      touchPoints: navigator.maxTouchPoints,
      userAgent: navigator.userAgent,
    }))
    checks.healthNoOverflow = healthMetrics.scrollWidth <= healthMetrics.width
    checks.touch = healthMetrics.touchPoints > 0
    checks.iPhoneUA = healthMetrics.userAgent.includes('iPhone')

    await page.screenshot({
      path: join(artifactDir, `${slug(name)}-health-ready.png`),
      fullPage: true,
      animations: 'disabled',
    })

    await page.goto(`${baseURL}/?fixture=counting-health-offline&iosMatrixCert=1&model=${encodeURIComponent(name)}`, { waitUntil: 'networkidle' })
    checks.countingVisible = await page.getByText('CONTEO FÍSICO', { exact: true }).first().isVisible().catch(() => false)
    const countMetrics = await page.evaluate(() => ({
      width: innerWidth,
      scrollWidth: document.documentElement.scrollWidth,
    }))
    checks.countingNoOverflow = countMetrics.scrollWidth <= countMetrics.width

    const passed = Object.values(checks).every(Boolean)
    results.push({ name, viewport: { width, height, dpr }, checks, passed })
    console.log(`[${passed ? 'PASS' : 'FAIL'}] ${name} ${width}x${height} DPR${dpr}`)
    await context.close()
  }

  const failed = results.filter((r) => !r.passed)
  const evidence = {
    schema: 'inven3.f9b.ios-matrix-certification.v1',
    generated_at: new Date().toISOString(),
    engine: 'Playwright WebKit',
    device_profiles: results.length,
    passed: results.length - failed.length,
    failed: failed.length,
    results,
    status: failed.length ? 'FAIL' : 'PASS',
  }
  const path = join(artifactDir, 'IOS-MATRIX-CERTIFICATION.json')
  writeFileSync(path, JSON.stringify(evidence, null, 2) + '\n')
  console.log('')
  console.log(`[${evidence.status}] IOS_VIRTUAL_DEVICE_MATRIX`)
  console.log(`Perfiles: ${evidence.passed}/${evidence.device_profiles} PASS`)
  console.log(`Evidencia: ${path}`)
  if (failed.length) process.exitCode = 2
} finally {
  if (browser?.isConnected()) await browser.close()
  server.kill()
}
