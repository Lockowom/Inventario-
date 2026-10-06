import { describe, expect, it, vi } from 'vitest'
import { DeviceHealthService, FIVE_MINUTES_MS } from '../../src/domain/device-health/device-health-service'
import { evaluateDeviceHealthOverall } from '../../src/domain/device-health/evaluate-overall'
import type { DeviceHealthCheck, LocalHealthProbe, LocalHealthProbeResult } from '../../src/domain/device-health/contracts'
import type { ResolvedCountingContext } from '../../src/domain/count/resolve-counting-context'
import type { MasterMetadata, MasterSku } from '../../src/domain/master/contracts'
import type { MasterSkuRepository } from '../../src/domain/ports/master-sku-repository'

const inventoryId = '11111111-1111-4111-8111-111111111111'
const userId = '22222222-2222-4222-8222-222222222222'
const now = new Date('2026-09-25T12:00:00.000Z')
const online: ResolvedCountingContext = { kind: 'ONLINE', context: { inventoryId, userId, inventoryStatus: 'ABIERTO' } }
const offline: ResolvedCountingContext = { kind: 'OFFLINE', context: { inventoryId, userId, inventoryStatus: 'ABIERTO' } }
const item: MasterSku = { inventoryId, codigo: '000123', descripcion: 'Producto', controlType: 'PARTIDA', cachedAt: now.toISOString() }
const metadata: MasterMetadata = { inventoryId, masterVersion: 1, rowCount: 1, fingerprint: 'a'.repeat(64), cachedAt: now.toISOString() }
const blocked = (reason: 'NOT_AUTHORIZED' | 'AMBIGUOUS' | 'CACHE_MISMATCH'): ResolvedCountingContext => ({ kind: 'BLOCKED', reason })
const passingCheck: DeviceHealthCheck = { key: 'APP_VERSION', status: 'PASS', blocking: false, message: 'ok' }
const allPassingChecks: readonly DeviceHealthCheck[] = [passingCheck, { key: 'AUTH_USER', status: 'PASS', blocking: true, message: 'ok' }]

class MemoryMasters implements MasterSkuRepository {
  public currentMetadata: MasterMetadata | null = metadata
  public items: MasterSku[] = [item]
  public lookup: MasterSku | null = item
  public async getMetadata() { return this.currentMetadata }
  public async listByInventory() { return this.items }
  public async findByCode() { return this.lookup }
  public async replaceSnapshot() {}
}

function probe(result: LocalHealthProbeResult = { databaseOperational: true, persistenceOperational: true, storageEstimate: { usage: 1, quota: 2 } }): LocalHealthProbe {
  return { probe: async () => result }
}

function scanner(checks: readonly DeviceHealthCheck[] = passiveChecks()) {
  return { probe: vi.fn(async () => checks) }
}

function passiveChecks(): readonly DeviceHealthCheck[] {
  return [
    { key: 'CAMERA_AVAILABLE', status: 'PASS', blocking: false, message: 'ok' },
    { key: 'CAMERA_PERMISSION', status: 'UNAVAILABLE', blocking: false, message: 'manual' },
    { key: 'SCANNER_AVAILABLE', status: 'PASS', blocking: false, message: 'ok' },
  ]
}

function service(overrides: Partial<ConstructorParameters<typeof DeviceHealthService>[0]> = {}) {
  const resolveContext = vi.fn(async () => online)
  const dependencies = {
    mode: 'LIGHT' as const,
    resolveContext,
    masters: new MemoryMasters(),
    localHealth: probe(),
    appVersion: { getVersion: async () => '1.2.3' },
    serverTime: { getServerTime: async () => new Date(now) },
    scanner: scanner(),
    now: () => new Date(now),
    ...overrides,
  }
  return { health: new DeviceHealthService(dependencies), resolveContext, dependencies }
}

function check(report: Awaited<ReturnType<DeviceHealthService['check']>>, key: DeviceHealthCheck['key']) {
  const value = report.checks.find((candidate) => candidate.key === key)
  if (!value) throw new Error(`Missing ${key}`)
  return value
}

describe('evaluateDeviceHealthOverall', () => {
  it.each(['NOT_AUTHORIZED', 'AMBIGUOUS', 'CACHE_MISMATCH'] as const)('returns BLOCKED for %s even when every check passes', (reason) => {
    expect(evaluateDeviceHealthOverall(allPassingChecks, blocked(reason))).toBe('BLOCKED')
  })

  it('returns READY online when all checks pass', () => {
    expect(evaluateDeviceHealthOverall(allPassingChecks, online)).toBe('READY')
  })

  it('returns READY_WITH_WARNINGS for online non-blocking warnings and failures', () => {
    expect(evaluateDeviceHealthOverall([{ ...passingCheck, status: 'WARN' }], online)).toBe('READY_WITH_WARNINGS')
    expect(evaluateDeviceHealthOverall([{ ...passingCheck, status: 'UNAVAILABLE' }], online)).toBe('READY_WITH_WARNINGS')
    expect(evaluateDeviceHealthOverall([{ ...passingCheck, status: 'FAIL' }], online)).toBe('READY_WITH_WARNINGS')
  })

  it('blocks any blocking failure before evaluating connectivity', () => {
    const failure = { ...passingCheck, status: 'FAIL' as const, blocking: true }
    expect(evaluateDeviceHealthOverall([failure], online)).toBe('BLOCKED')
    expect(evaluateDeviceHealthOverall([failure], offline)).toBe('BLOCKED')
  })

  it('returns READY_OFFLINE only for an offline context without blocking failures', () => {
    expect(evaluateDeviceHealthOverall(allPassingChecks, offline)).toBe('READY_OFFLINE')
    expect(evaluateDeviceHealthOverall([{ ...passingCheck, status: 'WARN' }], offline)).toBe('READY_OFFLINE')
  })
})

describe('DeviceHealthService', () => {
  it('produces READY with exactly one authorization resolution and preserves it', async () => {
    const { health, resolveContext } = service()
    const report = await health.check()
    expect(report.overall).toBe('READY_WITH_WARNINGS')
    expect(report.resolvedContext).toBe(online)
    expect(resolveContext).toHaveBeenCalledTimes(1)
    expect(report.checks.map((candidate) => candidate.key)).toEqual([
      'APP_VERSION', 'AUTH_USER', 'INVENTORY_CONTEXT', 'MASTER_SNAPSHOT', 'LOCAL_DATABASE', 'LOCAL_STORAGE',
      'BACKEND_CONNECTIVITY', 'DEVICE_TIME', 'CAMERA_AVAILABLE', 'CAMERA_PERMISSION', 'SCANNER_AVAILABLE',
    ])
  })

  it('is READY when every applicable check passes', async () => {
    const { health } = service({ scanner: scanner(passiveChecks().map((candidate) => ({ ...candidate, status: 'PASS' as const }))) })
    await expect(health.check()).resolves.toMatchObject({ overall: 'READY' })
  })

  it('hydrates the local master once while online before validating the snapshot', async () => {
    const masters = new MemoryMasters()
    masters.currentMetadata = null
    masters.items = []
    masters.lookup = null
    const hydrateMasterSnapshot = vi.fn(async (targetInventoryId: string) => {
      expect(targetInventoryId).toBe(inventoryId)
      masters.currentMetadata = metadata
      masters.items = [item]
      masters.lookup = item
    })
    const { health } = service({ masters, hydrateMasterSnapshot })
    const report = await health.check()
    expect(hydrateMasterSnapshot).toHaveBeenCalledTimes(1)
    expect(check(report, 'MASTER_SNAPSHOT').status).toBe('PASS')
  })

  it('does not hydrate the master during an offline health run', async () => {
    const hydrateMasterSnapshot = vi.fn(async () => undefined)
    const { health } = service({ resolveContext: async () => offline, hydrateMasterSnapshot })
    await health.check()
    expect(hydrateMasterSnapshot).not.toHaveBeenCalled()
  })

  it('allows a valid cached context as READY_OFFLINE', async () => {
    const { health } = service({ resolveContext: async () => offline })
    const report = await health.check()
    expect(report.overall).toBe('READY_OFFLINE')
    expect(check(report, 'BACKEND_CONNECTIVITY').status).toBe('WARN')
    expect(check(report, 'DEVICE_TIME').status).toBe('WARN')
  })

  it.each(['WARN', 'FAIL', 'UNAVAILABLE'] as const)('keeps scanner %s non-blocking', async (status) => {
    const { health } = service({ scanner: scanner([{ key: 'CAMERA_AVAILABLE', status: 'PASS', blocking: false, message: 'ok' }, { key: 'CAMERA_PERMISSION', status: 'PASS', blocking: false, message: 'ok' }, { key: 'SCANNER_AVAILABLE', status, blocking: false, message: 'manual' }]) })
    await expect(health.check()).resolves.toMatchObject({ overall: 'READY_WITH_WARNINGS' })
  })

  it('blocks local persistence failures', async () => {
    const { health } = service({ localHealth: probe({ databaseOperational: true, persistenceOperational: false, storageEstimate: null }) })
    const report = await health.check()
    expect(report.overall).toBe('BLOCKED')
    expect(check(report, 'LOCAL_DATABASE').status).toBe('FAIL')
    expect(check(report, 'LOCAL_STORAGE').status).toBe('FAIL')
  })

  it('blocks all invalid master snapshot variants', async () => {
    for (const adjust of [
      (masters: MemoryMasters) => { masters.currentMetadata = null },
      (masters: MemoryMasters) => { masters.currentMetadata = { ...metadata, inventoryId: '33333333-3333-4333-8333-333333333333' } },
      (masters: MemoryMasters) => { masters.currentMetadata = { ...metadata, rowCount: 0 } },
      (masters: MemoryMasters) => { masters.items = [] },
      (masters: MemoryMasters) => { masters.items = [{ ...item, inventoryId: '33333333-3333-4333-8333-333333333333' }] },
      (masters: MemoryMasters) => { masters.lookup = null },
    ]) {
      const masters = new MemoryMasters(); adjust(masters)
      const { health } = service({ masters })
      const report = await health.check()
      expect(report.overall).toBe('BLOCKED')
      expect(check(report, 'MASTER_SNAPSHOT').status).toBe('FAIL')
    }
  })

  it.each([
    { kind: 'BLOCKED', reason: 'NOT_AUTHORIZED' } as const,
    { kind: 'BLOCKED', reason: 'AMBIGUOUS' } as const,
    { kind: 'BLOCKED', reason: 'CACHE_MISMATCH' } as const,
  ])('blocks server context %o', async (resolvedContext) => {
    const { health } = service({ resolveContext: async () => resolvedContext })
    const report = await health.check()
    expect(report.overall).toBe('BLOCKED')
    expect(check(report, 'AUTH_USER').status).toBe('FAIL')
    expect(check(report, 'INVENTORY_CONTEXT').status).toBe('FAIL')
  })

  it('explains an ambiguous inventory authority without weakening the block', async () => {
    const { health } = service({ resolveContext: async () => ({ kind: 'BLOCKED', reason: 'AMBIGUOUS', diagnostic: 'MULTIPLE_OPEN_INVENTORIES' }) })
    const report = await health.check()
    expect(report.overall).toBe('BLOCKED')
    expect(check(report, 'AUTH_USER').message).toMatch(/más de un inventario activo/i)
    expect(check(report, 'INVENTORY_CONTEXT').message).toMatch(/más de un inventario activo/i)
  })

  it('does not claim multiple inventories when the validation query itself fails', async () => {
    const { health } = service({ resolveContext: async () => ({ kind: 'BLOCKED', reason: 'AMBIGUOUS', diagnostic: 'INVENTORIES_QUERY' }) })
    const report = await health.check()
    expect(report.overall).toBe('BLOCKED')
    expect(check(report, 'AUTH_USER').message).toMatch(/validar el inventario autorizado/i)
    expect(check(report, 'INVENTORY_CONTEXT').message).toMatch(/validar el inventario asignado/i)
    expect(check(report, 'INVENTORY_CONTEXT').message).not.toMatch(/más de un inventario activo/i)
  })

  it('enforces the exact five minute time boundary and accepts epoch zero', async () => {
    const atEpoch = new Date(0)
    const atLimit = service({ now: () => atEpoch, serverTime: { getServerTime: async () => new Date(FIVE_MINUTES_MS) } }).health
    const pastLimit = service({ now: () => atEpoch, serverTime: { getServerTime: async () => new Date(FIVE_MINUTES_MS + 1) } }).health
    await expect(atLimit.check()).resolves.toMatchObject({ overall: 'READY_WITH_WARNINGS' })
    const report = await pastLimit.check()
    expect(report.overall).toBe('BLOCKED')
    expect(check(report, 'DEVICE_TIME')).toMatchObject({ status: 'FAIL', observedValue: FIVE_MINUTES_MS + 1 })
  })

  it('returns a safe warning when server time is unavailable and blocks invalid device time', async () => {
    const unavailable = service({ serverTime: { getServerTime: async () => null } }).health
    const invalid = service({ now: () => new Date('invalid') }).health
    await expect(unavailable.check()).resolves.toMatchObject({ overall: 'READY_WITH_WARNINGS' })
    await expect(invalid.check()).resolves.toMatchObject({ overall: 'BLOCKED' })
  })
})
