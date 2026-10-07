import { Capacitor } from '@capacitor/core'
import { CapacitorUpdater } from '@capgo/capacitor-updater'
import { getSupabaseClient } from './supabase'

export type OtaUpdateState =
  | { kind: 'IDLE' | 'UNAVAILABLE' | 'UNASSIGNED' | 'UP_TO_DATE'; message: string }
  | { kind: 'DOWNLOADING' | 'READY'; message: string; version: string }
  | { kind: 'NATIVE_REQUIRED'; message: string; minNativeVersion: string }
  | { kind: 'ERROR'; message: string }

type OtaManifest = { update: null | { version: string; minNativeVersion: string; url: string; sha256: string }; enrollment?: string }

export function compareVersions(left: string, right: string): number {
  const parse = (value: string): [number, number, number, number] => {
    const match = /^(\d+)\.(\d+)\.(\d+)(?:-qa\.(\d+))?/.exec(value)
    return [Number(match?.[1] ?? 0), Number(match?.[2] ?? 0), Number(match?.[3] ?? 0), Number(match?.[4] ?? 0)]
  }
  const [leftMajor, leftMinor, leftPatch, leftQa] = parse(left); const [rightMajor, rightMinor, rightPatch, rightQa] = parse(right)
  return leftMajor - rightMajor || leftMinor - rightMinor || leftPatch - rightPatch || leftQa - rightQa
}

class OtaUpdateService {
  public async notifyLaunchReady(): Promise<void> {
    if (Capacitor.getPlatform() !== 'android' || !Capacitor.isPluginAvailable('CapacitorUpdater')) return
    await CapacitorUpdater.notifyAppReady()
  }

  public async check(): Promise<OtaUpdateState> {
    if (Capacitor.getPlatform() !== 'android' || !Capacitor.isPluginAvailable('CapacitorUpdater')) return { kind: 'UNAVAILABLE', message: 'Actualizaciones OTA disponibles sólo desde la futura APK base Android QA.' }
    try {
      const current = await CapacitorUpdater.current()
      const device = await CapacitorUpdater.getDeviceId()
      const client = getSupabaseClient()
      if (!client) return { kind: 'ERROR', message: 'OTA no configurada.' }
      const { data, error } = await client.functions.invoke<OtaManifest>('ota-updates', {
        body: { deviceId: device.deviceId, nativeVersion: current.native, currentBundleVersion: current.bundle.version, eventType: 'CHECKED' },
      })
      if (error || !data) return { kind: 'ERROR', message: 'No fue posible verificar la actualización OTA.' }
      if (!data.update) return { kind: 'UNASSIGNED', message: 'Dispositivo registrado en qa-beta. Aún no existe un bundle OTA posterior a esta APK base.' }
      if (compareVersions(current.native, data.update.minNativeVersion) < 0) return { kind: 'NATIVE_REQUIRED', minNativeVersion: data.update.minNativeVersion, message: `Esta operación requiere APK Android ${data.update.minNativeVersion} o superior.` }
      if (compareVersions(data.update.version, current.bundle.version) <= 0) return { kind: 'UP_TO_DATE', message: 'El bundle OTA ya está actualizado.' }
      const downloaded = await CapacitorUpdater.download({ version: data.update.version, url: data.update.url, checksum: data.update.sha256 })
      await client.functions.invoke('ota-updates', { body: { deviceId: device.deviceId, nativeVersion: current.native, currentBundleVersion: current.bundle.version, eventType: 'DOWNLOADED' } })
      await CapacitorUpdater.set(downloaded)
      return { kind: 'READY', version: data.update.version, message: `Actualización ${data.update.version} preparada. Aplíquela cuando sea seguro reiniciar.` }
    } catch (error: unknown) {
      console.error('OTA_CHECK_FAILED', error)
      return { kind: 'ERROR', message: 'La actualización OTA falló; se conserva el último bundle seguro.' }
    }
  }

  public async apply(): Promise<void> {
    if (Capacitor.getPlatform() !== 'android' || !Capacitor.isPluginAvailable('CapacitorUpdater')) return
    await CapacitorUpdater.reload()
  }

  public async rollback(): Promise<void> {
    if (Capacitor.getPlatform() !== 'android' || !Capacitor.isPluginAvailable('CapacitorUpdater')) return
    await CapacitorUpdater.reset({ toLastSuccessful: true })
    await CapacitorUpdater.reload()
  }
}

export const otaUpdateService = new OtaUpdateService()
