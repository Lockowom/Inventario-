import { expect, test } from '@playwright/test'

const viewports = [320, 360, 420, 600, 768, 900, 1024, 1440]

test.describe('F9A certificación responsive y accesible', () => {
  for (const width of viewports) {
    test(`cut READY no tiene overflow operativo a ${width}px`, async ({ page }) => {
      await page.setViewportSize({ width, height: 1000 })
      await page.goto('/?fixture=cuts-ready')
      await expect(page.getByRole('heading', { name: 'CORTES' })).toBeVisible()
      await expect(page.getByRole('button', { name: 'VER DETALLE' })).toBeVisible()
      await expect(page.getByRole('button', { name: 'DESCARGAR RP XLSX' })).toBeVisible()
      await expect(page.getByRole('button', { name: 'RECTIFICAR' })).toBeVisible()
      expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true)
    })
  }

  for (const [state, pending, message] of [
    ['counting-normal', 39, 'Pendientes: 39 / 50'],
    ['counting-warning', 40, 'Advertencia: existen varios conteos pendientes de sincronización.'],
    ['counting-critical', 45, 'Advertencia crítica: el dispositivo está próximo al límite de 50 conteos pendientes.'],
    ['counting-blocked', 50, 'Debe sincronizar antes de continuar; GUARDAR está bloqueado.'],
  ] as const) {
    test(`CountingScreen real certifica capacidad ${pending}`, async ({ page }) => {
      await page.setViewportSize({ width: 390, height: 844 })
      await page.goto(`/?fixture=${state}`)
      await expect(page.getByRole('heading', { name: 'CONTEO FÍSICO' })).toBeVisible()
      await expect(page.getByText(message)).toBeVisible()
      await expect(page.getByRole('heading', { name: 'MIS CONTEOS' })).toBeVisible()
      await expect(page.getByText('Pendiente de sincronización').first()).toBeVisible()
      await expect(page.getByText('Confirmado en servidor')).toBeVisible()
      await expect(page.getByText('Pendiente de reintento')).toBeVisible()
      if (pending === 50) await expect(page.getByRole('button', { name: 'GUARDAR CONTEO' })).toBeDisabled()
      else await expect(page.getByRole('button', { name: 'GUARDAR CONTEO' })).toBeEnabled()
      expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true)
    })
  }

  test('cut READY, rectificación efectiva y estados válidos de artefactos son visibles', async ({ page }) => {
    await page.setViewportSize({ width: 768, height: 1000 })
    await page.goto('/?fixture=rectification')
    await expect(page.getByText('CORTE 001 · READY')).toBeVisible()
    await expect(page.getByText('SNAPSHOT DEL CORTE')).toBeVisible()
    await expect(page.getByText('R001 · XLSX DE RECTIFICACIÓN')).toBeVisible()
    await expect(page.getByText('PENDIENTE DE GENERACIÓN')).toBeVisible()
    await expect(page.getByText('REQUIERE REINTENTO')).toBeVisible()
    await page.getByRole('button', { name: 'RECTIFICAR' }).click()
    await expect(page.getByRole('heading', { name: 'RECTIFICACIÓN POST-CORTE' })).toBeVisible()
    await expect(page.getByText('ESTADO EFECTIVO ACTUAL')).toBeVisible()
    await expect(page.getByText('R001').first()).toBeVisible()
    await expect(page.locator('fieldset').filter({ hasText: 'VALORES CORRECTOS' })).toBeVisible()
  })

  test('supervisión y maestro declaran sólo el smoke de layout sin backend', async ({ page }) => {
    await page.setViewportSize({ width: 1024, height: 900 })
    await page.goto('/?fixture=layout')
    await expect(page.getByRole('heading', { name: 'SUPERVISIÓN' })).toBeVisible()
    await expect(page.getByRole('heading', { name: 'Maestro SKU' })).toBeVisible()
    await expect(page.getByLabel('Inventario').last()).toBeVisible()
    await expect(page.getByLabel(/Archivo maestro/)).toBeVisible()
    await expect(page.getByRole('button', { name: 'ACTUALIZAR' })).toBeVisible()
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true)
  })
})
