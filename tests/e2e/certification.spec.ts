import { expect, test } from '@playwright/test'

const viewports = [320, 360, 390, 412, 420, 430, 600, 768, 900, 1024, 1440]

test.describe('F9A certificación responsive y accesible', () => {
  for (const [state, label] of [
    ['health-ready', 'DISPOSITIVO LISTO PARA INVENTARIO'],
    ['health-offline', 'DISPOSITIVO LISTO PARA INVENTARIO OFFLINE'],
    ['health-warning', 'DISPOSITIVO LISTO CON ADVERTENCIAS'],
    ['health-blocked', 'REVISIÓN REQUERIDA'],
  ] as const) {
    test(`Device Health muestra ${state} con contrato y sin overflow`, async ({ page }) => {
      await page.setViewportSize({ width: 390, height: 844 })
      await page.goto(`/?fixture=${state}`)
      await expect(page.getByRole('heading', { name: 'HEALTH CHECK DEL DISPOSITIVO' })).toBeVisible()
      await expect(page.getByText(label)).toBeVisible()
      await expect(page.getByText('Versión de la aplicación')).toBeVisible()
      await expect(page.getByText('Scanner', { exact: true })).toBeVisible()
      expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true)
    })
  }

  for (const width of [320, 390, 412, 430, 768, 1024, 1440]) {
    test(`Device Health es responsive a ${width}px`, async ({ page }) => {
      await page.setViewportSize({ width, height: 1000 })
      await page.goto('/?fixture=health-blocked')
      await expect(page.getByRole('heading', { name: 'HEALTH CHECK DEL DISPOSITIVO' })).toBeVisible()
      expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true)
    })
  }

  test('Health BLOCKED conserva MIS CONTEOS y sincronización, pero bloquea nueva captura', async ({ page }) => {
    await page.setViewportSize({ width: 320, height: 900 })
    await page.goto('/?fixture=counting-health-blocked')
    await expect(page.getByText('REVISIÓN REQUERIDA')).toBeVisible()
    await expect(page.getByRole('heading', { name: 'CONTEO FÍSICO' })).toBeVisible()
    await expect(page.getByRole('button', { name: 'GUARDAR CONTEO' })).toBeDisabled()
    await expect(page.getByRole('button', { name: 'Escanear ubicacion' })).toBeDisabled()
    await expect(page.getByRole('heading', { name: 'MIS CONTEOS' })).toBeVisible()
    await expect(page.getByText('Pendiente de sincronización').first()).toBeVisible()
    await expect(page.getByText('Confirmado en servidor')).toBeVisible()
    await expect(page.getByText('Pendiente de reintento')).toBeVisible()
    await expect(page.getByRole('button', { name: 'SINCRONIZAR AHORA' })).toBeEnabled()
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true)
  })

  test('READY_OFFLINE permite captura con runtime válido', async ({ page }) => {
    await page.setViewportSize({ width: 390, height: 844 })
    await page.goto('/?fixture=counting-health-offline')
    await expect(page.getByRole('button', { name: 'GUARDAR CONTEO' })).toBeEnabled()
  })

  for (const width of viewports) {
    test(`CutsScreen READY real no tiene overflow operativo a ${width}px`, async ({ page }) => {
      await page.setViewportSize({ width, height: 1000 })
      await page.goto('/?fixture=cuts-ready')
      await expect(page.getByRole('heading', { name: 'CORTES', exact: true })).toBeVisible()
      await expect(page.getByRole('button', { name: 'VER DETALLE' })).toBeVisible()
      await expect(page.getByRole('button', { name: 'DESCARGAR RP XLSX' })).toBeVisible()
      await page.getByRole('button', { name: 'VER DETALLE' }).click()
      await expect(page.getByRole('heading', { name: 'Detalle inmutable' })).toBeVisible()
      await expect(page.getByText('#1 · 00001 · 3')).toBeVisible()
      await expect(page.getByRole('heading', { name: 'RECTIFICACIONES' })).toBeVisible()
      await expect(page.getByRole('heading', { name: 'EVIDENCIAS Y RESPALDOS' })).toBeVisible()
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

  for (const [width, state, message, blocked] of [
    [320, 'counting-warning', 'Advertencia: existen varios conteos pendientes de sincronización.', false],
    [390, 'counting-critical', 'Advertencia crítica: el dispositivo está próximo al límite de 50 conteos pendientes.', false],
    [412, 'counting-blocked', 'Debe sincronizar antes de continuar; GUARDAR está bloqueado.', true],
    [430, 'counting-warning', 'Advertencia: existen varios conteos pendientes de sincronización.', false],
  ] as const) {
    test(`CountingScreen mantiene captura usable a ${width}px`, async ({ page }) => {
      await page.setViewportSize({ width, height: 844 })
      await page.goto(`/?fixture=${state}`)
      await expect(page.getByRole('heading', { name: 'CONTEO FÍSICO' })).toBeVisible()
      await expect(page.getByText(message)).toBeVisible()
      await expect(page.getByRole('heading', { name: 'MIS CONTEOS' })).toBeVisible()
      const save = page.getByRole('button', { name: 'GUARDAR CONTEO' })
      await expect(save).toBeVisible()
      if (blocked) await expect(save).toBeDisabled()
      else await expect(save).toBeEnabled()
      expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true)
    })
  }

  test('READY_OFFLINE mantiene GUARDAR alcanzable con viewport reducido tipo teclado', async ({ page }) => {
    await page.setViewportSize({ width: 390, height: 500 })
    await page.goto('/?fixture=counting-health-offline')
    const section = page.locator('section.counting-screen')
    const code = section.locator('label.field').filter({ hasText: /^CODIGO/ }).locator('input').first()
    await code.focus()
    const save = section.getByRole('button', { name: 'GUARDAR CONTEO' })
    await save.scrollIntoViewIfNeeded()
    await expect(save).toBeVisible()
    expect(await save.evaluate((element) => {
      const rect = element.getBoundingClientRect()
      return rect.top < window.innerHeight && rect.bottom > 0
    })).toBe(true)
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true)
  })

  test('READY_OFFLINE no desborda en landscape móvil', async ({ page }) => {
    await page.setViewportSize({ width: 844, height: 390 })
    await page.goto('/?fixture=counting-health-offline')
    await expect(page.getByRole('heading', { name: 'CONTEO FÍSICO' })).toBeVisible()
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true)
  })

  test('CutsScreen real muestra el flujo READY y rectificación efectiva', async ({ page }) => {
    await page.setViewportSize({ width: 768, height: 1000 })
    await page.goto('/?fixture=rectification')
    await expect(page.getByText('CORTE 001 · READY')).toBeVisible()
    await page.getByRole('button', { name: 'VER DETALLE' }).click()
    await expect(page.getByRole('heading', { name: 'Detalle inmutable' })).toBeVisible()
    await expect(page.getByText('SNAPSHOT DEL CORTE')).toBeVisible()
    await page.getByRole('button', { name: 'RECTIFICAR' }).click()
    await expect(page.getByRole('heading', { name: 'RECTIFICACIÓN POST-CORTE' })).toBeVisible()
    await expect(page.getByText('ESTADO EFECTIVO ACTUAL')).toBeVisible()
    await expect(page.getByText('R001').first()).toBeVisible()
    await expect(page.locator('fieldset').filter({ hasText: 'VALORES CORRECTOS' })).toBeVisible()
  })

  test('CutsScreen real muestra estados válidos de artefactos tras VER DETALLE', async ({ page }) => {
    await page.setViewportSize({ width: 1024, height: 1000 })
    await page.goto('/?fixture=artifacts')
    await page.getByRole('button', { name: 'VER DETALLE' }).click()
    await expect(page.getByText('SNAPSHOT DEL CORTE')).toBeVisible()
    await expect(page.getByText('PENDIENTE DE GENERACIÓN')).toBeVisible()
    await expect(page.getByText('R001 · XLSX DE RECTIFICACIÓN')).toBeVisible()
    await expect(page.getByText('LISTO')).toBeVisible()
    await expect(page.getByText('RESPALDO TÉCNICO DEL CORTE')).toBeVisible()
    await expect(page.getByText('REQUIERE REINTENTO')).toBeVisible()
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
