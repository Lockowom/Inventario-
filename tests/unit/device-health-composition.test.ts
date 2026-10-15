import { describe, expect, it, vi } from 'vitest'
import { createCaptureGate } from '../../src/features/device-health/capture-gate'
import { runDeviceHealthCheck } from '../../src/features/device-health/device-health-runner'
import type { DeviceHealthReport } from '../../src/domain/device-health/contracts'

const context = { inventoryId: 'inventory', userId: 'user', inventoryStatus: 'ABIERTO' } as const
const readyReport: DeviceHealthReport = { mode: 'LIGHT', overall: 'READY', checks: [], resolvedContext: { kind: 'ONLINE', context }, checkedAt: '2026-09-25T12:00:00.000Z' }

describe('Device Health app composition', () => {
  it('uses the single Health report context to create runtime without a second authorization resolution', async () => {
    const check = vi.fn(async () => readyReport)
    const createService = vi.fn(() => ({ check }))
    const createRuntime = vi.fn((activeContext) => ({ activeContext }))
    const result = await runDeviceHealthCheck('LIGHT', { createService, createCountingRuntime: createRuntime })
    expect(createService).toHaveBeenCalledTimes(1)
    expect(check).toHaveBeenCalledTimes(1)
    expect(createRuntime).toHaveBeenCalledWith(context)
    expect(result.runtime).toEqual({ activeContext: context })
  })

  it('does not create capture runtime for a blocked resolved context', async () => {
    const createRuntime = vi.fn()
    const blocked: DeviceHealthReport = { ...readyReport, overall: 'BLOCKED', resolvedContext: { kind: 'BLOCKED', reason: 'NOT_AUTHORIZED' } }
    const result = await runDeviceHealthCheck('LIGHT', { createService: () => ({ check: async () => blocked }), createCountingRuntime: createRuntime })
    expect(result.runtime).toBeNull()
    expect(createRuntime).not.toHaveBeenCalled()
  })

  it('keeps new capture unavailable initially, after runner errors, and after a blocked refresh', () => {
    expect(createCaptureGate(null, true, null).blocked).toBe(true)
    expect(createCaptureGate(readyReport, false, 'No fue posible comprobar el dispositivo. Actualice el diagnóstico antes de capturar.').blocked).toBe(true)
    expect(createCaptureGate({ ...readyReport, overall: 'BLOCKED' }, false, null).blocked).toBe(true)
  })

  it.each(['READY', 'READY_OFFLINE', 'READY_WITH_WARNINGS'] as const)('does not block capture for %s', (overall) => {
    expect(createCaptureGate({ ...readyReport, overall }, false, null)).toEqual({ blocked: false, message: null })
  })

  it('rehabilitates capture immediately after a later READY report', () => {
    expect(createCaptureGate({ ...readyReport, overall: 'BLOCKED' }, false, null).blocked).toBe(true)
    expect(createCaptureGate(readyReport, false, null).blocked).toBe(false)
  })
})
