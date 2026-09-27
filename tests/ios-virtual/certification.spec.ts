import { expect, test } from '@playwright/test'
import { mkdirSync } from 'node:fs'
import { join } from 'node:path'

const artifactDir = join(process.cwd(), 'artifacts', 'ios-virtual')

const scenarios = [
  { fixture: 'health-ready', name: 'device-health-ready', marker: 'HEALTH CHECK DEL DISPOSITIVO' },
  { fixture: 'counting-health-offline', name: 'counting-offline', marker: 'CONTEO FÍSICO' },
  { fixture: 'cuts-ready', name: 'cuts-ready', marker: 'CORTES' },
  { fixture: 'layout', name: 'supervision-layout', marker: 'SUPERVISIÓN' },
] as const

test.beforeAll(() => mkdirSync(artifactDir, { recursive: true }))

for (const scenario of scenarios) {
  test(`iPhone 15 WebKit · ${scenario.name}`, async ({ page, browserName }) => {
    expect(browserName).toBe('webkit')
    await page.goto(`/?fixture=${scenario.fixture}`)
    await expect(page.getByText(scenario.marker, { exact: true }).first()).toBeVisible()

    const runtime = await page.evaluate(() => ({
      width: window.innerWidth,
      height: window.innerHeight,
      scrollWidth: document.documentElement.scrollWidth,
      touchPoints: navigator.maxTouchPoints,
      userAgent: navigator.userAgent,
    }))

    expect(runtime.width).toBeGreaterThanOrEqual(390)
    expect(runtime.scrollWidth).toBeLessThanOrEqual(runtime.width)
    expect(runtime.touchPoints).toBeGreaterThan(0)
    expect(runtime.userAgent).toContain('iPhone')

    await page.screenshot({
      path: join(artifactDir, `${scenario.name}-iphone15.png`),
      fullPage: true,
      animations: 'disabled',
    })
  })
}

test('iPhone 15 WebKit · landscape no desborda', async ({ page }) => {
  await page.setViewportSize({ width: 844, height: 390 })
  await page.goto('/?fixture=counting-health-offline')
  await expect(page.getByRole('heading', { name: 'CONTEO FÍSICO' })).toBeVisible()
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true)
  await page.screenshot({
    path: join(artifactDir, 'counting-offline-iphone15-landscape.png'),
    fullPage: true,
    animations: 'disabled',
  })
})
