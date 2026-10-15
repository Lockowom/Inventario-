import { defineConfig, devices } from '@playwright/test'

export default defineConfig({
  // Keep certification isolated from a developer Vite process. Reusing 4173
  // made fixture runs non-deterministic and caused the historic navigation
  // timeout when an older bundle was still serving that port.
  use: { baseURL: 'http://127.0.0.1:4174' },
  snapshotPathTemplate: '{testDir}/visual-snapshots/{testFilePath}/{arg}{ext}',
  webServer: {
    command: 'npm run dev -- --host 127.0.0.1 --port 4174',
    url: 'http://127.0.0.1:4174',
    reuseExistingServer: false,
    env: { VITE_CERTIFICATION_FIXTURE: '1' },
  },
  projects: [
    { name: 'chromium', testDir: './tests/e2e', use: { ...devices['Desktop Chrome'] } },
    { name: 'visual', testDir: './tests/visual', use: { ...devices['Desktop Chrome'] } },
    {
      name: 'ios-webkit',
      testDir: './tests/ios-virtual',
      use: {
        ...devices['iPhone 15'],
        browserName: 'webkit',
        hasTouch: true,
        isMobile: true,
        locale: 'es-CL',
        colorScheme: 'dark',
      },
    },
  ],
})
