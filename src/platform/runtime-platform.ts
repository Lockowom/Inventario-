import { Capacitor } from '@capacitor/core'
import { isTauri } from '@tauri-apps/api/core'
import type { PlatformAdapter, RuntimePlatform } from './contracts'
import { CapacitorPlatformAdapter } from './capacitor/capacitor-platform-adapter'
import { WebPlatformAdapter } from './web/web-platform-adapter'
import { WindowsPlatformAdapter } from './windows/windows-platform-adapter'

const web = new WebPlatformAdapter()
const capacitor = new CapacitorPlatformAdapter()
const windows = new WindowsPlatformAdapter()

export type RuntimeSignals = { tauri: boolean; capacitorPlatform: string }

/** Capability-based selection; it never relies on a user agent. */
export function resolveRuntimePlatform({ tauri, capacitorPlatform }: RuntimeSignals): RuntimePlatform {
  if (tauri) return 'windows'
  return capacitorPlatform === 'android' || capacitorPlatform === 'ios' ? capacitorPlatform : 'web'
}

export function getPlatformAdapterForRuntime(signals: RuntimeSignals): PlatformAdapter {
  switch (resolveRuntimePlatform(signals)) {
    case 'windows': return windows
    case 'android':
    case 'ios': return capacitor
    case 'web': return web
  }
}

/** The only live platform selector. */
export function getPlatformAdapter(): PlatformAdapter {
  return getPlatformAdapterForRuntime({ tauri: isTauri(), capacitorPlatform: Capacitor.getPlatform() })
}

export function getPlatformCapabilities() {
  return getPlatformAdapter().capabilities
}
