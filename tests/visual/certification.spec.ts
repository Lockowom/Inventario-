import { expect, test } from '@playwright/test'

const snapshots = [
  { name: 'counting-blocked-mobile', width: 320, height: 900, state: 'counting-blocked', ready: 'Debe sincronizar antes de continuar; GUARDAR está bloqueado.' },
  { name: 'rectification-tablet', width: 768, height: 1000, state: 'rectification', ready: 'RECTIFICAR' },
  { name: 'cuts-artifacts-desktop', width: 1440, height: 1100, state: 'artifacts', ready: 'EVIDENCIAS Y RESPALDOS' },
]

for (const snapshot of snapshots) {
  test(`snapshot determinista ${snapshot.name}`, async ({ page }) => {
    await page.setViewportSize({ width: snapshot.width, height: snapshot.height })
    await page.emulateMedia({ reducedMotion: 'reduce' })
    await page.goto(`/?fixture=${snapshot.state}`)
    await page.addStyleTag({ content: '*,*::before,*::after{animation:none!important;transition:none!important;caret-color:transparent!important}' })
    if (snapshot.state === 'rectification' || snapshot.state === 'artifacts') await page.getByRole('button', { name: 'VER DETALLE' }).click()
    if (snapshot.state === 'rectification') await page.getByRole('button', { name: 'RECTIFICAR' }).click()
    // Keep the non-semantic explanatory copy to one desktop line so host font
    // metrics cannot change the artifact panel's captured height.
    if (snapshot.state === 'artifacts') await page.addStyleTag({ content: '.artifact-panel>header>p{font-size:14px!important;line-height:20px!important;white-space:nowrap!important;overflow:hidden!important;text-overflow:ellipsis!important}' })
    await expect(page.getByText(snapshot.ready).first()).toBeVisible()
    const target = snapshot.state === 'artifacts' ? page.locator('.artifact-panel') : page
    // Baselines are shared by Windows development and Linux CI. The bounded
    // tolerance absorbs host font rasterization; overflow is asserted in e2e.
    await expect(target).toHaveScreenshot(`f9-${snapshot.name}.png`, { animations: 'disabled', maxDiffPixelRatio: 0.1 })
  })
}
