import { webkit } from '@playwright/test'
import { spawn } from 'node:child_process'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const viteBin = join(root, 'node_modules', 'vite', 'bin', 'vite.js')
const fixture = process.argv[2] || 'health-ready'
const host = '127.0.0.1'
const port = 4173
const baseURL = `http://${host}:${port}`

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
    try {
      const response = await fetch(baseURL)
      if (response.ok) return
    } catch {}
    await new Promise((resolve) => setTimeout(resolve, 250))
  }
  throw new Error('Vite no quedó disponible en 30 segundos.')
}

let browser
try {
  await waitForServer()
  browser = await webkit.launch({ headless: false })
  const context = await browser.newContext({
    viewport: { width: 1120, height: 1040 },
    locale: 'es-CL',
    colorScheme: 'dark',
  })
  const page = await context.newPage()
  await page.goto(`${baseURL}/ios-device-lab.html?fixture=${encodeURIComponent(fixture)}`)
  console.log('')
  console.log('INVEN3 — iOS DEVICE LAB')
  console.log('Marco visual: iPhone 15 Pro Max')
  console.log('Motor: WebKit')
  console.log(`Fixture: ${fixture}`)
  console.log('Cierra la ventana para terminar.')
  await new Promise((resolve) => browser.on('disconnected', resolve))
} catch (error) {
  console.error(error)
  if (String(error).includes('Executable doesn')) {
    console.error('Instala WebKit con: npx playwright install webkit')
  }
  process.exitCode = 1
} finally {
  if (browser?.isConnected()) await browser.close()
  server.kill()
}
