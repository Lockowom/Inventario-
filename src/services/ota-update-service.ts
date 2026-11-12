import type { AuthChangeEvent } from '@supabase/supabase-js'
import type { CurrentUpdateBundle } from '../platform/contracts'
import { getPlatformAdapter } from '../platform/runtime-platform'
import { getSupabaseClient } from './supabase'

export type OtaUpdateState =
  | { kind: 'IDLE' | 'UNAVAILABLE' | 'DEFERRED' | 'UNASSIGNED' | 'UP_TO_DATE' | 'CHECKING'; message: string }
  | { kind: 'DOWNLOADING'; message: string; version: string; progress: number }
  | { kind: 'PREPARING' | 'READY' | 'APPLYING'; message: string; version: string }
  | { kind: 'NATIVE_REQUIRED'; message: string; minNativeVersion: string; minVersionCode: number }
  | { kind: 'ERROR'; message: string; canRollback: boolean }

type OtaManifest = { update: null | { version: string; minNativeVersion: string; minVersionCode: number; url: string; sha256: string; sizeBytes: number }; enrollment?: string }
type CurrentOtaBundle = CurrentUpdateBundle

const deferredForSession = (): OtaUpdateState => ({ kind: 'DEFERRED', message: 'La verificación OTA se realizará automáticamente al recuperar sesión o conexión.' })
const deferredForNetwork = (): OtaUpdateState => ({ kind: 'DEFERRED', message: 'Sin conexión. INVEN3 continuará con la versión actual y verificará actualizaciones al reconectar.' })

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

/** Supports the current INVEN3 four-part identity and legacy QA test fixtures. */
export function compareVersions(left: string, right: string): number {
  const parse = (value: string): [number, number, number, number, number] => {
    const canonical = /^(\d+)\.(\d+)\.(\d{2})\.(\d{2})(?:-qa\.(\d+))?$/.exec(value)
    if (canonical) return [Number(canonical[1]), Number(canonical[2]), Number(canonical[3]), Number(canonical[4]), Number(canonical[5] ?? 0)]
    const legacy = /^(\d+)\.(\d+)\.(\d+)(?:-qa\.(\d+))?$/.exec(value)
    return [Number(legacy?.[1] ?? 0), Number(legacy?.[2] ?? 0), Number(legacy?.[3] ?? 0), 0, Number(legacy?.[4] ?? 0)]
  }
  const a = parse(left); const b = parse(right)
  return a[0] - b[0] || a[1] - b[1] || a[2] - b[2] || a[3] - b[3] || a[4] - b[4]
}

function isBuiltin(current: CurrentOtaBundle | undefined): boolean {
  return !current || current.bundle.id === 'builtin'
}

function effectiveVersion(current: CurrentOtaBundle): string {
  return isBuiltin(current) || !current.bundle.version || current.bundle.version === 'builtin' ? current.native : current.bundle.version
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
  private readyVersion: string | null = null
  private readonly listeners = new Set<(state: OtaUpdateState) => void>()

  public subscribe(listener: (state: OtaUpdateState) => void): () => void {
    this.listeners.add(listener)
    return () => this.listeners.delete(listener)
  }

  public async notifyLaunchReady(): Promise<void> { await getPlatformAdapter().updater.notifyLaunchReady() }

  public check(): Promise<OtaUpdateState> {
    if (this.checkInFlight) return this.checkInFlight
    const request = this.performCheck()
    this.checkInFlight = request
    void request.finally(() => { if (this.checkInFlight === request) this.checkInFlight = null })
    return request
  }

  /** Never reload while the caller reports an active C1/C2/C3 screen or unsafe outbox. */
  public async applyWhenSafe(isSafePoint: () => boolean | Promise<boolean>): Promise<OtaUpdateState | null> {
    const updater = getPlatformAdapter().updater
    if (!this.readyVersion || !updater.isAvailable()) return null
    if (!(await isSafePoint())) return this.publish({ kind: 'READY', version: this.readyVersion, message: `Actualización ${this.readyVersion} lista. Se aplicará automáticamente al salir de una operación activa o en el próximo inicio seguro.` })
    this.publish({ kind: 'APPLYING', version: this.readyVersion, message: `Aplicando actualización ${this.readyVersion}…` })
    try {
      await updater.reload()
      return null
    } catch (error: unknown) {
      return this.realError('No fue posible aplicar la actualización OTA; se conserva el último bundle seguro.', this.lastKnownCurrent, error)
    }
  }

  public async rollback(): Promise<void> {
    const updater = getPlatformAdapter().updater
    if (!this.rollbackAllowed || !updater.isAvailable()) return
    await updater.resetToLastSuccessful()
    await updater.reload()
  }

  private async performCheck(): Promise<OtaUpdateState> {
    const updater = getPlatformAdapter().updater
    if (!updater.isAvailable()) return this.publish({ kind: 'UNAVAILABLE', message: 'Actualizaciones OTA disponibles en Android QA.' })
    if (typeof navigator !== 'undefined' && navigator.onLine === false) return this.publish(deferredForNetwork())
    this.publish({ kind: 'CHECKING', message: 'Buscando actualización…' })
    let current: CurrentOtaBundle | undefined
    try {
      current = await updater.current()
      this.lastKnownCurrent = current
      const deviceId = await updater.getDeviceId()
      const client = getSupabaseClient()
      if (!client) return this.publish(deferredForSession())
      const session = await client.auth.getSession()
      if (session.error) return this.publish(isNetworkFailure(session.error) ? deferredForNetwork() : deferredForSession())
      if (!session.data.session) return this.publish(deferredForSession())
      const installedAppVersion = effectiveVersion(current)
      const eventBase = { deviceId, nativeVersion: current.native, nativeVersionCode: current.nativeVersionCode ?? null, appVersion: installedAppVersion, currentBundleVersion: installedAppVersion }
      const { data, error } = await client.functions.invoke<OtaManifest>('ota-updates', { body: { ...eventBase, eventType: isBuiltin(current) ? 'CHECKED' : 'APPLIED' } })
      if (error) {
        if (isUnauthorized(error)) return this.publish(deferredForSession())
        if (isNetworkFailure(error)) return this.publish(deferredForNetwork())
        return this.realError('No fue posible verificar la actualización OTA.', current, error)
      }
      if (!data) return this.realError('No fue posible verificar la actualización OTA.', current)
      if (!data.update) return this.publish({ kind: 'UNASSIGNED', message: 'Canal QA-BETA sin actualización disponible.' })
      if (compareVersions(current.native, data.update.minNativeVersion) < 0 || ((current.nativeVersionCode ?? 0) > 0 && current.nativeVersionCode! < data.update.minVersionCode)) {
        await client.functions.invoke('ota-updates', { body: { ...eventBase, eventType: 'INCOMPATIBLE' } })
        return this.publish({ kind: 'NATIVE_REQUIRED', minNativeVersion: data.update.minNativeVersion, minVersionCode: data.update.minVersionCode, message: `Esta actualización requiere APK ${data.update.minNativeVersion} (build ${data.update.minVersionCode}) o superior.` })
      }
      if (compareVersions(data.update.version, installedAppVersion) <= 0) return this.publish({ kind: 'UP_TO_DATE', message: `INVEN3 ${installedAppVersion} está actualizado.` })
      this.publish({ kind: 'DOWNLOADING', version: data.update.version, progress: 0, message: `Descargando actualización ${data.update.version}…` })
      const downloaded = await updater.download({ version: data.update.version, url: data.update.url, checksum: data.update.sha256 }, (progress) => {
        this.publish({ kind: 'DOWNLOADING', version: data.update!.version, progress, message: `Descargando actualización ${data.update!.version}… ${progress}%` })
      })
      this.publish({ kind: 'PREPARING', version: data.update.version, message: `Preparando actualización ${data.update.version}…` })
      await updater.set(downloaded)
      await client.functions.invoke('ota-updates', { body: { ...eventBase, eventType: 'DOWNLOADED' } })
      this.readyVersion = data.update.version
      return this.publish({ kind: 'READY', version: data.update.version, message: `Actualización ${data.update.version} lista. Se aplicará automáticamente en un punto seguro.` })
    } catch (error: unknown) {
      if (isUnauthorized(error)) return this.publish(deferredForSession())
      if (isNetworkFailure(error)) return this.publish(deferredForNetwork())
      return this.realError('La actualización OTA falló; se conserva el último bundle seguro.', current, error)
    }
  }

  private publish(state: OtaUpdateState): OtaUpdateState {
    for (const listener of this.listeners) listener(state)
    return state
  }

  private realError(message: string, current: CurrentOtaBundle | undefined, error?: unknown): OtaUpdateState {
    void error // Never log credentials, headers, URLs or session data.
    this.rollbackAllowed = !isBuiltin(current)
    return this.publish({ kind: 'ERROR', message, canRollback: this.rollbackAllowed })
  }
}

export const otaUpdateService = new OtaUpdateService()
