import { expect, test } from '@playwright/test'

for (const viewport of [{ name: 'mobile-320', width: 320, height: 900 }, { name: 'tablet-768', width: 768, height: 1000 }, { name: 'desktop-1440', width: 1440, height: 1100 }]) {
  test(`snapshot determinista ${viewport.name}`, async ({ page }) => {
    await page.setViewportSize({ width: viewport.width, height: viewport.height })
    await page.emulateMedia({ reducedMotion: 'reduce' })
    await page.goto('/')
    await page.addStyleTag({ content: '*,*::before,*::after{animation:none!important;transition:none!important;caret-color:transparent!important}' })
    await page.getByRole('button', { name: 'RECTIFICAR' }).click()
    await expect(page.getByRole('heading', { name: 'RECTIFICACIÓN POST-CORTE' })).toBeVisible()
    // Baselines are shared by Windows development and Linux CI. The bounded
    // tolerance absorbs host font rasterization while preserving layout/state
    // regression signal; explicit overflow checks live in the e2e suite.
    await expect(page).toHaveScreenshot(`f9-${viewport.name}.png`, { fullPage: false, animations: 'disabled', maxDiffPixelRatio: 0.1 })
  })
}
