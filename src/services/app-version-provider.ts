import { App } from '@capacitor/app'
import { Capacitor } from '@capacitor/core'
import type { AppVersionProvider } from '../domain/device-health/contracts'

const buildVersion = import.meta.env.VITE_APP_VERSION ?? '0.1.0'

export class CapacitorAppVersionProvider implements AppVersionProvider {
  public async getVersion(): Promise<string | null> {
    if (Capacitor.getPlatform() !== 'web') {
      try {
        const version = (await App.getInfo()).version.trim()
        if (version) return version
      } catch { /* Build version remains the safe fallback. */ }
    }
    const fallback = buildVersion.trim()
    return fallback || null
  }
}
