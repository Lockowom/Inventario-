import type { MasterSkuRepository } from '../ports/master-sku-repository'
import type { ResolvedCountingContext } from '../count/resolve-counting-context'
import { evaluateDeviceHealthOverall } from './evaluate-overall'
import type { AppVersionProvider, DeviceHealthCheck, DeviceHealthMode, DeviceHealthReport, LocalHealthProbe, PassiveScannerHealthProbe, ServerTimeGateway } from './contracts'

const FIVE_MINUTES_MS = 300_000

export interface DeviceHealthDependencies {
  mode: DeviceHealthMode
  resolveContext(): Promise<ResolvedCountingContext>
  masters: MasterSkuRepository
  localHealth: LocalHealthProbe
  appVersion: AppVersionProvider
  serverTime: ServerTimeGateway
  scanner: PassiveScannerHealthProbe
  hydrateMasterSnapshot?(inventoryId: string): Promise<void>
  now?: () => Date
}

export class DeviceHealthService {
  public constructor(private readonly dependencies: DeviceHealthDependencies) {}

  public async check(): Promise<DeviceHealthReport> {
    const now = this.dependencies.now ?? (() => new Date(Date.now()))
    const checkedAt = validIso(now())
    const context = await this.dependencies.resolveContext()
    if (context.kind === 'ONLINE' && this.dependencies.hydrateMasterSnapshot) {
      await safely(() => this.dependencies.hydrateMasterSnapshot!(context.context.inventoryId))
    }
    const checks: DeviceHealthCheck[] = []

    checks.push(await this.checkAppVersion())
    checks.push(this.checkAuthUser(context))
    checks.push(this.checkInventoryContext(context))
    checks.push(await this.checkMasterSnapshot(context))
    checks.push(...await this.checkLocalHealth())
    checks.push(this.checkBackendConnectivity(context))
    checks.push(await this.checkDeviceTime(context, now()))
    checks.push(...await this.dependencies.scanner.probe(this.dependencies.mode))

    return { mode: this.dependencies.mode, overall: evaluateDeviceHealthOverall(checks, context), checks, resolvedContext: context, checkedAt: checkedAt ?? new Date(0).toISOString() }
  }

  private async checkAppVersion(): Promise<DeviceHealthCheck> {
    const version = await safely(this.dependencies.appVersion.getVersion)
    return version && version.trim().length > 0
      ? { key: 'APP_VERSION', status: 'PASS', blocking: false, message: 'Versión instalada identificada.', observedValue: version.trim() }
      : { key: 'APP_VERSION', status: 'WARN', blocking: false, message: 'No fue posible identificar la versión instalada.' }
  }

  private checkAuthUser(context: ResolvedCountingContext): DeviceHealthCheck {
    if (context.kind !== 'BLOCKED') return { key: 'AUTH_USER', status: 'PASS', blocking: true, message: 'Identidad autorizada disponible localmente.' }
    return { key: 'AUTH_USER', status: 'FAIL', blocking: true, message: 'Inicie sesión con un usuario activo.' }
  }

  private checkInventoryContext(context: ResolvedCountingContext): DeviceHealthCheck {
    if (context.kind === 'BLOCKED') return { key: 'INVENTORY_CONTEXT', status: 'FAIL', blocking: true, message: 'Seleccione un inventario autorizado.' }
    if (context.context.inventoryStatus === 'ABIERTO') return { key: 'INVENTORY_CONTEXT', status: 'PASS', blocking: true, message: 'Inventario abierto autorizado.' }
    return { key: 'INVENTORY_CONTEXT', status: 'PASS', blocking: true, message: 'C1 cerrado: sólo se permite un reconteo C2/C3 asignado.' }
  }

  private async checkMasterSnapshot(context: ResolvedCountingContext): Promise<DeviceHealthCheck> {
    if (context.kind === 'BLOCKED') return { key: 'MASTER_SNAPSHOT', status: 'FAIL', blocking: true, message: 'El maestro de este inventario no está disponible localmente.' }
    try {
      const { inventoryId } = context.context
      const metadata = await this.dependencies.masters.getMetadata(inventoryId)
      if (!metadata || metadata.inventoryId !== inventoryId || metadata.rowCount <= 0) throw new Error('invalid metadata')
      const items = await this.dependencies.masters.listByInventory(inventoryId)
      if (items.length !== metadata.rowCount || items.some((item) => item.inventoryId !== inventoryId) || !items[0]) throw new Error('invalid items')
      const lookup = await this.dependencies.masters.findByCode(inventoryId, items[0].codigo)
      if (!lookup || lookup.inventoryId !== inventoryId || lookup.codigo !== items[0].codigo) throw new Error('invalid lookup')
      return { key: 'MASTER_SNAPSHOT', status: 'PASS', blocking: true, message: 'Maestro local disponible.', observedValue: metadata.rowCount }
    } catch {
      return { key: 'MASTER_SNAPSHOT', status: 'FAIL', blocking: true, message: 'El maestro de este inventario no está disponible localmente.' }
    }
  }

  private async checkLocalHealth(): Promise<readonly DeviceHealthCheck[]> {
    try {
      const result = await this.dependencies.localHealth.probe()
      const database: DeviceHealthCheck = result.databaseOperational
        ? { key: 'LOCAL_DATABASE', status: 'PASS', blocking: true, message: 'La base local está disponible.' }
        : { key: 'LOCAL_DATABASE', status: 'FAIL', blocking: true, message: 'La base local no está disponible. No capture conteos.' }
      if (!result.persistenceOperational) return [database.status === 'PASS' ? { key: 'LOCAL_DATABASE', status: 'FAIL', blocking: true, message: 'La base local no está disponible. No capture conteos.' } : database, { key: 'LOCAL_STORAGE', status: 'FAIL', blocking: true, message: 'No hay almacenamiento local disponible para proteger los conteos.' }]
      const storage: DeviceHealthCheck = result.storageEstimate === null
        ? { key: 'LOCAL_STORAGE', status: 'WARN', blocking: false, message: 'No fue posible observar el espacio libre del dispositivo.' }
        : { key: 'LOCAL_STORAGE', status: 'PASS', blocking: true, message: 'El almacenamiento local está disponible.' }
      return [database, storage]
    } catch {
      return [
        { key: 'LOCAL_DATABASE', status: 'FAIL', blocking: true, message: 'La base local no está disponible. No capture conteos.' },
        { key: 'LOCAL_STORAGE', status: 'FAIL', blocking: true, message: 'No hay almacenamiento local disponible para proteger los conteos.' },
      ]
    }
  }

  private checkBackendConnectivity(context: ResolvedCountingContext): DeviceHealthCheck {
    if (context.kind === 'ONLINE') return { key: 'BACKEND_CONNECTIVITY', status: 'PASS', blocking: false, message: 'Servidor disponible.' }
    if (context.kind === 'OFFLINE') return { key: 'BACKEND_CONNECTIVITY', status: 'WARN', blocking: false, message: 'Servidor no disponible ahora. Puede trabajar offline y sincronizar después.' }
    return { key: 'BACKEND_CONNECTIVITY', status: context.reason === 'CACHE_MISMATCH' ? 'WARN' : 'PASS', blocking: false, message: context.reason === 'CACHE_MISMATCH' ? 'No fue posible verificar el servidor.' : 'Servidor disponible.' }
  }

  private async checkDeviceTime(context: ResolvedCountingContext, deviceTime: Date): Promise<DeviceHealthCheck> {
    const localIso = validIso(deviceTime)
    if (!localIso) return { key: 'DEVICE_TIME', status: 'FAIL', blocking: true, message: 'La hora del dispositivo no es válida.' }
    if (context.kind !== 'ONLINE') return { key: 'DEVICE_TIME', status: 'WARN', blocking: false, message: 'No fue posible comparar la hora del dispositivo con el servidor.' }
    const serverTime = await safely(this.dependencies.serverTime.getServerTime)
    if (!serverTime || !validIso(serverTime)) return { key: 'DEVICE_TIME', status: 'WARN', blocking: false, message: 'No fue posible comparar la hora del dispositivo con el servidor.' }
    const driftMs = Math.abs(deviceTime.getTime() - serverTime.getTime())
    return driftMs <= FIVE_MINUTES_MS
      ? { key: 'DEVICE_TIME', status: 'PASS', blocking: true, message: 'La hora del dispositivo coincide con el servidor.', observedValue: driftMs }
      : { key: 'DEVICE_TIME', status: 'FAIL', blocking: true, message: 'La hora del dispositivo difiere del servidor. Corríjala antes de capturar.', observedValue: driftMs }
  }
}

function validIso(value: Date): string | null {
  if (!(value instanceof Date) || Number.isNaN(value.getTime())) return null
  try { return value.toISOString() } catch { return null }
}

async function safely<T>(operation: () => Promise<T>): Promise<T | null> {
  try { return await operation() } catch { return null }
}

export { FIVE_MINUTES_MS }
