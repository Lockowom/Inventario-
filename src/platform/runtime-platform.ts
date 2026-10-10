import { Capacitor } from '@capacitor/core'
import type { PlatformAdapter } from './contracts'
import { CapacitorPlatformAdapter } from './capacitor/capacitor-platform-adapter'
import { WebPlatformAdapter } from './web/web-platform-adapter'

const web = new WebPlatformAdapter()
const capacitor = new CapacitorPlatformAdapter()

/** The only platform selector. Tauri will register a Windows adapter here in WIN-02/WIN-06. */
export function getPlatformAdapter(): PlatformAdapter {
  return Capacitor.getPlatform() === 'web' ? web : capacitor
}

export function getPlatformCapabilities() {
  return getPlatformAdapter().capabilities
}
