import { defineConfig, devices } from '@playwright/test'

export default defineConfig({
  use: { baseURL: 'http://127.0.0.1:4173' },
  snapshotPathTemplate: '{testDir}/visual-snapshots/{testFilePath}/{arg}{ext}',
  webServer: {
    command: 'npm run dev -- --host 127.0.0.1 --port 4173',
    url: 'http://127.0.0.1:4173',
    reuseExistingServer: !process.env.CI,
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
