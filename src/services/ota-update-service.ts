import type { AuthChangeEvent } from '@supabase/supabase-js'
import type { CurrentUpdateBundle } from '../platform/contracts'
import { getPlatformAdapter } from '../platform/runtime-platform'
import { getSupabaseClient } from './supabase'

export type OtaUpdateState =
  | { kind: 'IDLE' | 'UNAVAILABLE' | 'DEFERRED' | 'UNASSIGNED' | 'UP_TO_DATE' | 'CHECKING'; message: string }
  | { kind: 'DOWNLOADING' | 'READY'; message: string; version: string }
  | { kind: 'NATIVE_REQUIRED'; message: string; minNativeVersion: string }
  | { kind: 'ERROR'; message: string; canRollback: boolean }

type OtaManifest = { update: null | { version: string; minNativeVersion: string; url: string; sha256: string }; enrollment?: string }
type CurrentOtaBundle = CurrentUpdateBundle

const deferredForSession = (): OtaUpdateState => ({ kind: 'DEFERRED', message: 'La verificación OTA se realizará al recuperar sesión o conexión.' })
const deferredForNetwork = (): OtaUpdateState => ({ kind: 'DEFERRED', message: 'Sin conexión. La actualización se verificará automáticamente al volver online.' })

export function shouldRetryOtaForAuthEvent(event: AuthChangeEvent): boolean {
  return event === 'SIGNED_IN' || event === 'TOKEN_REFRESHED' || event === 'USER_UPDATED'
}

export function bindOtaRetryEvents(
  subscribeAuth: (listener: (event: AuthChangeEvent) => void) => { unsubscribe(): void },
  retry: () => void,
): () => void {
  const subscription = subscribeAuth((event) => { if (shouldRetryOtaForAuthEvent(event)) retry() })
  const online = () => retry()
  window.addEventListener('online', online)
  return () => { subscription.unsubscribe(); window.removeEventListener('online', online) }
}

export function compareVersions(left: string, right: string): number {
  const parse = (value: string): [number, number, number, number] => {
    const match = /^(\d+)\.(\d+)\.(\d+)(?:-qa\.(\d+))?/.exec(value)
    return [Number(match?.[1] ?? 0), Number(match?.[2] ?? 0), Number(match?.[3] ?? 0), Number(match?.[4] ?? 0)]
  }
  const [leftMajor, leftMinor, leftPatch, leftQa] = parse(left); const [rightMajor, rightMinor, rightPatch, rightQa] = parse(right)
  return leftMajor - rightMajor || leftMinor - rightMinor || leftPatch - rightPatch || leftQa - rightQa
}

function isBuiltin(current: CurrentOtaBundle | undefined): boolean {
  return !current || current.bundle.id === 'builtin'
}

function isUnauthorized(error: unknown): boolean {
  if (!error || typeof error !== 'object') return false
  const context = (error as { context?: { status?: unknown } }).context
  if (context?.status === 401) return true
  return /\b401\b|unauthori[sz]ed/i.test(String((error as { message?: unknown }).message ?? ''))
}

function isNetworkFailure(error: unknown): boolean {
  if (typeof navigator !== 'undefined' && navigator.onLine === false) return true
  if (!error || typeof error !== 'object') return false
  const name = String((error as { name?: unknown }).name ?? '')
  const message = String((error as { message?: unknown }).message ?? '')
  const status = (error as { context?: { status?: unknown } }).context?.status
  return name === 'FunctionsFetchError' || name === 'FunctionsRelayError' || status === 502 || status === 503 || status === 504 || /network|fetch|offline|failed to fetch/i.test(message)
}

export class OtaUpdateService {
  private checkInFlight: Promise<OtaUpdateState> | null = null
  private rollbackAllowed = false
  private lastKnownCurrent: CurrentOtaBundle | undefined

  public async notifyLaunchReady(): Promise<void> {
    await getPlatformAdapter().updater.notifyLaunchReady()
  }

  public check(): Promise<OtaUpdateState> {
    if (this.checkInFlight) return this.checkInFlight
    const request = this.performCheck()
    this.checkInFlight = request
    void request.finally(() => { if (this.checkInFlight === request) this.checkInFlight = null })
    return request
  }

  private async performCheck(): Promise<OtaUpdateState> {
    const updater = getPlatformAdapter().updater
    if (!updater.isAvailable()) return { kind: 'UNAVAILABLE', message: 'Actualizaciones OTA disponibles sólo desde la futura APK base Android QA.' }
    if (typeof navigator !== 'undefined' && navigator.onLine === false) return deferredForNetwork()
    let current: CurrentOtaBundle | undefined
    try {
      current = await updater.current()
      this.lastKnownCurrent = current
      const deviceId = await updater.getDeviceId()
      const client = getSupabaseClient()
      if (!client) return deferredForSession()
      const session = await client.auth.getSession()
      if (session.error) return isNetworkFailure(session.error) ? deferredForNetwork() : deferredForSession()
      if (!session.data.session) return deferredForSession()
      const { data, error } = await client.functions.invoke<OtaManifest>('ota-updates', {
        body: { deviceId, nativeVersion: current.native, currentBundleVersion: current.bundle.version, eventType: 'CHECKED' },
      })
      if (error) {
        if (isUnauthorized(error)) return deferredForSession()
        if (isNetworkFailure(error)) return deferredForNetwork()
        return this.realError('No fue posible verificar la actualización OTA.', current)
      }
      if (!data) return this.realError('No fue posible verificar la actualización OTA.', current)
      if (!data.update) return { kind: 'UNASSIGNED', message: 'QA-BETA · SIN ACTUALIZACIÓN DISPONIBLE' }
      if (compareVersions(current.native, data.update.minNativeVersion) < 0) return { kind: 'NATIVE_REQUIRED', minNativeVersion: data.update.minNativeVersion, message: `Esta operación requiere APK Android ${data.update.minNativeVersion} o superior.` }
      if (compareVersions(data.update.version, current.bundle.version) <= 0) return { kind: 'UP_TO_DATE', message: 'El bundle OTA ya está actualizado.' }
      const downloaded = await updater.download({ version: data.update.version, url: data.update.url, checksum: data.update.sha256 })
      await client.functions.invoke('ota-updates', { body: { deviceId, nativeVersion: current.native, currentBundleVersion: current.bundle.version, eventType: 'DOWNLOADED' } })
      await updater.set(downloaded)
      return { kind: 'READY', version: data.update.version, message: `Actualización ${data.update.version} preparada. Aplíquela cuando sea seguro reiniciar.` }
    } catch (error: unknown) {
      if (isUnauthorized(error)) return deferredForSession()
      if (isNetworkFailure(error)) return deferredForNetwork()
      console.error('OTA_CHECK_FAILED', error)
      return this.realError('La actualización OTA falló; se conserva el último bundle seguro.', current)
    }
  }

  public async apply(): Promise<OtaUpdateState | null> {
    const updater = getPlatformAdapter().updater
    if (!updater.isAvailable()) return null
    try {
      await updater.reload()
      return null
    } catch (error: unknown) {
      console.error('OTA_APPLY_FAILED', error)
      return this.realError('No fue posible aplicar la actualización OTA.', this.lastKnownCurrent)
    }
  }

  public async rollback(): Promise<void> {
    const updater = getPlatformAdapter().updater
    if (!this.rollbackAllowed || !updater.isAvailable()) return
    await updater.resetToLastSuccessful()
    await updater.reload()
  }

  private realError(message: string, current: CurrentOtaBundle | undefined): OtaUpdateState {
    this.rollbackAllowed = !isBuiltin(current)
    return { kind: 'ERROR', message, canRollback: this.rollbackAllowed }
  }
}

export const otaUpdateService = new OtaUpdateService()
