import type { CapacitorConfig } from '@capacitor/cli'

const config: CapacitorConfig = {
  appId: 'com.lockowom.inven3',
  appName: 'INVEN3',
  webDir: 'dist',
  server: { androidScheme: 'https' },
  // OTA-01: manual Android QA flow. No default channel is configured, so a
  // device cannot self-enrol in qa-beta; an ADMIN must assign it server-side.
  plugins: {
    CapacitorUpdater: {
      appId: 'com.lockowom.inven3',
      autoUpdate: 'off',
      allowSetDefaultChannel: false,
      allowModifyUrl: false,
      allowModifyAppId: false,
      allowShakeChannelSelector: false,
      appReadyTimeout: 10_000,
    },
  },
}

export default config
