import type { AppVersionProvider } from '../domain/device-health/contracts'
import { getPlatformAdapter } from '../platform/runtime-platform'

export class CapacitorAppVersionProvider implements AppVersionProvider {
  public async getVersion(): Promise<string | null> {
    return getPlatformAdapter().lifecycle.getVersion()
  }
}
