import { useMemo } from 'react'
import { SupervisionScreen } from '../features/supervision/supervision-screen'
import { MasterSkuScreen } from '../features/master/master-sku-screen'
import { CountingScreen, type CountingRuntime } from '../features/counting/counting-screen'
import { CutsScreen } from '../features/cuts/cuts-screen'
import { DeviceHealthScreen } from '../features/device-health/device-health-screen'
import { PendingCountCapacityError, type CountListFilter, type CountRepository } from '../domain/ports/count-repository'
import type { MasterSkuRepository } from '../domain/ports/master-sku-repository'
import type { LocalCountRecord } from '../domain/count/contracts'
import type { MasterSku } from '../domain/master/contracts'
import type { ArtifactGeneration, CutRectification, RectificationsRepository } from '../features/rectifications/contracts'
import { SupabaseCutsRepository } from '../services/supabase-cuts-repository'
import { readCertificationFixtureState } from './certification-fixture-state'
import type { DeviceHealthCheck, DeviceHealthReport } from '../domain/device-health/contracts'
import type { SyncCoordinator } from '../domain/sync/sync-coordinator'

const inventoryId = '11111111-1111-4111-8111-111111111111'
const userId = '22222222-2222-4222-8222-222222222222'
const deviceId = '33333333-3333-4333-8333-333333333333'
const cutId = '44444444-4444-4444-8444-444444444444'
const recordId = '55555555-5555-4555-8555-555555555555'
const rectificationId = '66666666-6666-4666-8666-666666666666'
const fixedAt = '2026-09-24T12:00:00.000Z'

const master: MasterSku = { inventoryId, codigo: '00001', descripcion: 'Producto de certificación', controlType: 'PARTIDA', cachedAt: fixedAt }
const masters: MasterSkuRepository = {
  findByCode: async (_inventoryId, code) => code.trim().toUpperCase() === master.codigo ? master : null,
  listByInventory: async () => [master],
  getMetadata: async () => ({ inventoryId, masterVersion: 1, rowCount: 1, fingerprint: 'a'.repeat(64), cachedAt: fixedAt }),
  replaceSnapshot: async () => undefined,
}

function uuid(sequence: number) { return `70000000-0000-4000-8000-${String(sequence).padStart(12, '0')}` }
function countRecord(sequence: number, syncStatus: LocalCountRecord['syncStatus']): LocalCountRecord {
  return {
    id: uuid(sequence), clientCountId: uuid(10_000 + sequence), inventoryId, userId, deviceId,
    ubicacion: 'A-01-01', codigo: '00001', serie: null, partida: '00725', piezaProducto: null,
    fechaVencimiento: null, talla: 'L', color: 'Negro', cantidadContada: 3, descripcion: master.descripcion,
    controlType: 'PARTIDA', capturedAt: fixedAt, createdAt: fixedAt, syncStatus, syncAttempts: syncStatus === 'FAILED' ? 1 : 0,
    lastSyncError: syncStatus === 'FAILED' ? 'Red temporalmente no disponible' : null, syncStartedAt: null,
    nextRetryAt: null, confirmedAt: syncStatus === 'CONFIRMED' ? fixedAt : null,
    serverCountId: syncStatus === 'CONFIRMED' ? uuid(20_000 + sequence) : null, lastSyncAt: null,
  }
}

class FixtureCountRepository implements CountRepository {
  public constructor(private readonly records: LocalCountRecord[]) {}
  public async getOrCreateDeviceId() { return deviceId }
  public async save(record: LocalCountRecord) { this.records.push(record); return record }
  public async savePendingWithCapacity(record: LocalCountRecord, maxPending: number) {
    const pending = await this.countPendingByDevice(record.deviceId)
    if (pending >= maxPending) throw new PendingCountCapacityError(maxPending)
    this.records.push(record)
    return { record, pending: pending + 1 }
  }
  public async findByClientId(clientCountId: string) { return this.records.find((record) => record.clientCountId === clientCountId) ?? null }
  public async listOwnCounts(filter: CountListFilter) {
    const search = filter.search?.trim().toUpperCase()
    return this.records.filter((record) => record.inventoryId === filter.inventoryId && record.userId === filter.userId && (!search || [record.codigo, record.serie, record.partida, record.ubicacion].some((value) => value?.toUpperCase().includes(search))))
  }
  public async listOutstandingSyncScopes(scopeUserId: string) { return this.records.some((record) => record.userId === scopeUserId && record.syncStatus !== 'CONFIRMED' && record.syncStatus !== 'REJECTED') ? [{ inventoryId, userId: scopeUserId }] : [] }
  public async countPendingByDevice(id: string) { return this.records.filter((record) => record.deviceId === id && record.syncStatus === 'PENDING').length }
  public async countOutstandingByInventoryDevice(nextInventoryId: string, id: string) { return this.records.filter((record) => record.inventoryId === nextInventoryId && record.deviceId === id && record.syncStatus !== 'CONFIRMED' && record.syncStatus !== 'REJECTED').length }
  public async claimNextSyncBatch() { return [] }
  public async recoverStaleSyncing() { return 0 }
  public async applySyncAcknowledgements() { return undefined }
  public async markSyncFailed() { return undefined }
}

function countingRuntime(pending: number): CountingRuntime {
  // Pending is actual durable outbox state; MyCounts also receives terminal and retry examples.
  const records = Array.from({ length: pending }, (_, index) => countRecord(index + 1, 'PENDING'))
  records.push(countRecord(10_001, 'CONFIRMED'), countRecord(10_002, 'FAILED'))
  return { context: { inventoryId, userId, inventoryStatus: 'ABIERTO' }, masters, counts: new FixtureCountRepository(records), now: () => new Date(fixedAt), createUuid: () => uuid(90_000) }
}

const healthBaseChecks: readonly DeviceHealthCheck[] = [
  { key: 'APP_VERSION', status: 'PASS', blocking: false, message: 'Versión instalada identificada.' },
  { key: 'AUTH_USER', status: 'PASS', blocking: true, message: 'Usuario local válido.' },
  { key: 'INVENTORY_CONTEXT', status: 'PASS', blocking: true, message: 'Inventario abierto autorizado.' },
  { key: 'MASTER_SNAPSHOT', status: 'PASS', blocking: true, message: 'Maestro local disponible.' },
  { key: 'LOCAL_DATABASE', status: 'PASS', blocking: true, message: 'La base local está disponible.' },
  { key: 'LOCAL_STORAGE', status: 'PASS', blocking: true, message: 'El almacenamiento local está disponible.' },
  { key: 'BACKEND_CONNECTIVITY', status: 'PASS', blocking: false, message: 'Servidor disponible.' },
  { key: 'DEVICE_TIME', status: 'PASS', blocking: true, message: 'La hora del dispositivo coincide con el servidor.' },
  { key: 'CAMERA_AVAILABLE', status: 'PASS', blocking: false, message: 'Cámara disponible.' },
  { key: 'CAMERA_PERMISSION', status: 'PASS', blocking: false, message: 'Permiso de cámara concedido.' },
  { key: 'SCANNER_AVAILABLE', status: 'PASS', blocking: false, message: 'Scanner disponible.' },
]

type HealthFixtureState = 'health-ready' | 'health-offline' | 'health-warning' | 'health-blocked' | 'counting-health-blocked' | 'counting-health-offline'

function healthReport(state: HealthFixtureState): DeviceHealthReport {
  const offline = state === 'health-offline' || state === 'counting-health-offline'
  const blocked = state === 'health-blocked' || state === 'counting-health-blocked'
  const warning = state === 'health-warning'
  const checks = healthBaseChecks.map((check) => {
    if (offline && check.key === 'BACKEND_CONNECTIVITY') return { ...check, status: 'WARN' as const, message: 'Servidor no disponible ahora. Puede trabajar offline y sincronizar después.' }
    if (offline && check.key === 'DEVICE_TIME') return { ...check, status: 'WARN' as const, blocking: false, message: 'No fue posible comparar la hora del dispositivo con el servidor.' }
    if (warning && check.key === 'LOCAL_STORAGE') return { ...check, status: 'WARN' as const, blocking: false, message: 'No fue posible observar el espacio libre del dispositivo.' }
    if (warning && check.key === 'CAMERA_PERMISSION') return { ...check, status: 'UNAVAILABLE' as const, blocking: false, message: 'Permiso de cámara no concedido; puede ingresar los datos manualmente.' }
    if (warning && check.key === 'SCANNER_AVAILABLE') return { ...check, status: 'WARN' as const, blocking: false, message: 'Scanner no disponible; puede ingresar los datos manualmente.' }
    if (blocked && check.key === 'DEVICE_TIME') return { ...check, status: 'FAIL' as const, blocking: true, message: 'La hora del dispositivo difiere del servidor. Corríjala antes de capturar.' }
    return check
  })
  return { mode: 'LIGHT', overall: blocked ? 'BLOCKED' : offline ? 'READY_OFFLINE' : warning ? 'READY_WITH_WARNINGS' : 'READY', checks, resolvedContext: offline ? { kind: 'OFFLINE', context: { inventoryId, userId, inventoryStatus: 'ABIERTO' } } : { kind: 'ONLINE', context: { inventoryId, userId, inventoryStatus: 'ABIERTO' } }, checkedAt: fixedAt }
}

const fixtureSyncCoordinator = {
  runInventorySync: async () => ({ claimed: 0, confirmed: 0, rejected: 0, failed: 0, conflicts: 0, diagnostic: null }),
  runOutstanding: async () => ({ scopes: 1, claimed: 0, confirmed: 0, rejected: 0, failed: 0, conflicts: 0, diagnostic: null }),
} as unknown as SyncCoordinator

const values = { ubicacion: 'A-01-01', codigo: '00001', serie: '', partida: '00725', pieza_producto: '001234', fecha_vencimiento: '2027-04-10', talla: 'L', color: 'Negro', cantidad_contada: 3, descripcion: 'Producto de certificación' }
const correctedValues = { ...values, cantidad_contada: 4 }
const rectification: CutRectification = { id: rectificationId, cut_id: cutId, count_record_id: recordId, rectification_number: 1, old_values: values, new_values: correctedValues, reason: 'Corrección sintética certificable', created_at: fixedAt, created_by: userId }
const artifacts: ArtifactGeneration[] = [
  { id: '77777777-7777-4777-8777-777777777777', inventory_id: inventoryId, cut_id: cutId, rectification_id: null, artifact_type: 'SNAPSHOT', scope: 'CUT_SNAPSHOT', status: 'REQUESTED', created_at: fixedAt, as_of_at: fixedAt, file_name: null, sha256: null, size_bytes: null, error_safe: null },
  { id: '88888888-8888-4888-8888-888888888888', inventory_id: inventoryId, cut_id: cutId, rectification_id: null, artifact_type: 'TECHNICAL_BACKUP', scope: 'CUT_READY_BACKUP', status: 'ERROR', created_at: fixedAt, as_of_at: fixedAt, file_name: null, sha256: null, size_bytes: null, error_safe: 'SAFE_ERROR' },
  { id: '99999999-9999-4999-8999-999999999999', inventory_id: inventoryId, cut_id: cutId, rectification_id: rectificationId, artifact_type: 'RECTIFICATION_XLSX', scope: 'RECTIFICATION_XLSX', status: 'READY', created_at: fixedAt, as_of_at: fixedAt, file_name: 'INVEN3_CERTIFICATION_R001.xlsx', sha256: 'a'.repeat(64), size_bytes: 1024, error_safe: null },
]
const repository: RectificationsRepository = {
  rectifyCut: async () => ({ id: rectificationId, rectification_number: 1, idempotent: false }), rectifications: async () => [rectification], artifacts: async () => artifacts,
  generateArtifact: async () => undefined, downloadArtifact: async () => ({ signedUrl: 'https://example.invalid/file', fileName: 'INVEN3_CERTIFICATION.xlsx' }),
  masterItem: async (_inventoryId, codigo) => ({ codigo, descripcion: master.descripcion, control_type: 'PARTIDA' }),
}

const fixtureCutsRepository = {
  inventories: async () => [{ id: inventoryId, name: 'Inventario de certificación', status: 'ABIERTO' }],
  myProfile: async () => ({ role: 'ADMIN', active: true }),
  cuts: async () => [{ id: cutId, cut_number: 1, status: 'READY', record_count: 1, first_export_seq: 1, last_export_seq: 1 }],
  items: async () => [{ count_record_id: recordId, export_seq: 1, snapshot: values }],
  downloadRpXlsx: async () => ({ signedUrl: 'https://example.invalid/INVEN3_CERTIFICATION.xlsx', fileName: 'INVEN3_CERTIFICATION.xlsx' }),
  generateRpXlsx: async () => ({ action: 'READY' }),
  createCut: async () => ({ id: cutId, cut_number: 1, record_count: 1 }),
  correctionContext: async () => ({ count: { id: recordId, ...values }, revisions: [] }),
  correct: async () => ({ revision_number: 1 }),
} as unknown as SupabaseCutsRepository

/** DEV-only deterministic composition for Playwright; it has no production route. */
export function CertificationFixture() {
  const state = readCertificationFixtureState(window.location.search)
  const capacity = state === 'counting-warning' ? 40 : state === 'counting-critical' ? 45 : state === 'counting-blocked' ? 50 : 39
  const runtime = useMemo(() => countingRuntime(capacity), [capacity])
  const healthState: HealthFixtureState | null = state === 'counting-health-blocked' || state === 'counting-health-offline' ? state : state.startsWith('health-') ? state as HealthFixtureState : null
  const report = healthState ? healthReport(healthState) : null
  return <main className="app-shell certification-fixture">
    <header><p className="eyebrow">Fase 9 · fixture DEV determinista</p><h1>INVEN3 CERTIFICATION</h1><p>Datos sintéticos contractualmente válidos para regresión visual y accesibilidad.</p></header>
    {report && <DeviceHealthScreen report={report} loading={false} error={null} onRefresh={() => undefined} onFullCheck={() => undefined} />}
    {state.startsWith('counting-') && <CountingScreen runtime={runtime} syncCoordinator={fixtureSyncCoordinator} captureGate={state === 'counting-health-blocked' ? { blocked: true, message: 'Captura bloqueada por Health Check. Revise los controles marcados como FAIL.' } : undefined} />}
    {state === 'layout' && <><SupervisionScreen /><MasterSkuScreen /></>}
    {['cuts-ready', 'rectification', 'artifacts'].includes(state) && <CutsScreen cutsRepository={fixtureCutsRepository} rectificationsRepository={repository} />}
  </main>
}
