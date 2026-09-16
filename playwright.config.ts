import { defineConfig, devices } from '@playwright/test'

export default defineConfig({
  testDir: './tests',
  projects: [
    { name: 'chromium', use: { ...devices['Desktop Chrome'] } },
    { name: 'visual', testMatch: /visual\/.*\.spec\.ts/, use: { ...devices['Desktop Chrome'] } },
  ],
})
