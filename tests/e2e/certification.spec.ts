import { expect, test } from '@playwright/test'

const viewports = [320, 360, 420, 600, 768, 900, 1024, 1440]

test.describe('F9 certificación responsive y accesible', () => {
  for (const width of viewports) {
    test(`sin overflow operativo y controles críticos accesibles a ${width}px`, async ({ page }) => {
      await page.setViewportSize({ width, height: 1000 })
      await page.goto('/')
      await expect(page.getByRole('heading', { name: 'CONTEO FÍSICO' })).toBeVisible()
      await expect(page.getByRole('heading', { name: 'SUPERVISIÓN' })).toBeVisible()
      await expect(page.getByRole('heading', { name: 'CORTES' })).toBeVisible()
      await expect(page.getByRole('heading', { name: 'RECTIFICACIONES' })).toBeVisible()
      await expect(page.getByRole('heading', { name: 'EVIDENCIAS Y RESPALDOS' })).toBeVisible()
      await page.getByRole('button', { name: 'RECTIFICAR' }).click()
      await expect(page.getByLabel('MOTIVO OBLIGATORIO')).toBeVisible()
      await expect(page.getByRole('button', { name: 'GUARDAR RECTIFICACIÓN' })).toBeVisible()
      expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true)
      const focusable = await page.locator('button, input, select, textarea').count()
      expect(focusable).toBeGreaterThan(10)
    })
  }

  test('los estados de artefacto y el formulario mantienen labels, fieldset y aria-live', async ({ page }) => {
    await page.setViewportSize({ width: 390, height: 844 })
    await page.goto('/')
    await page.getByRole('button', { name: 'RECTIFICAR' }).click()
    await expect(page.getByRole('heading', { name: 'RECTIFICACIÓN POST-CORTE' })).toBeVisible()
    await expect(page.locator('fieldset').filter({ hasText: 'VALORES CORRECTOS' })).toBeVisible()
    await expect(page.getByText('PENDIENTE DE GENERACIÓN')).toBeVisible()
    await expect(page.getByText('REQUIERE REINTENTO')).toBeVisible()
    await expect(page.locator('[role="status"]').first()).toBeVisible()
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true)
  })
})
