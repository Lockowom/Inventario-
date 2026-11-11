import type { CapacitorConfig } from '@capacitor/cli'

// CUT2-11C is deliberately bound to the rebuilt INVEN3-QA project. This URL is
// native configuration, not a frontend secret, and is immutable from JavaScript.
const inven3QaOtaEndpoint = 'https://kpsdephjbvkwvazxubtb.supabase.co/functions/v1/ota-updates'

const config: CapacitorConfig = {
  appId: 'com.lockowom.inven3',
  appName: 'INVEN3',
  webDir: 'dist',
  server: { androidScheme: 'https' },
  // OTA-09: manual Android QA flow. The backend, never the client, places a
  // new authenticated QA device in the only allowed channel: qa-beta.
  plugins: {
    CapacitorUpdater: {
      appId: 'com.lockowom.inven3',
      autoUpdate: 'off',
      updateUrl: inven3QaOtaEndpoint,
      statsUrl: '',
      allowSetDefaultChannel: false,
      allowModifyUrl: false,
      allowModifyAppId: false,
      allowShakeChannelSelector: false,
      appReadyTimeout: 10_000,
    },
  },
}

export default config
