import { render, waitFor } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'

const h = vi.hoisted(() => ({
  createSyncCoordinator: vi.fn(),
  runDeviceHealthCheck: vi.fn(),
}))

vi.mock('../../src/services/supabase', () => ({
  isSupabaseConfigured: true,
  getSupabaseClient: () => null,
}))

vi.mock('../../src/features/auth/auth-service', () => ({
  authService: {
    hasRuntimeIdentity: async () => true,
    onAuthStateChange: () => ({ unsubscribe: () => undefined }),
    onLocalSignOut: () => ({ unsubscribe: () => undefined }),
    invalidateLocalAuthority: async () => undefined,
    signOut: async () => undefined,
  },
}))

vi.mock('../../src/features/counting/counting-runtime', () => ({
  createCountingRuntime: vi.fn(),
  createSyncCoordinator: h.createSyncCoordinator,
  getCountingContextRepository: () => ({
    get: async () => null,
    clear: async () => undefined,
  }),
}))

vi.mock('../../src/features/device-health/device-health-runner', () => ({
  runDeviceHealthCheck: h.runDeviceHealthCheck,
}))

vi.mock('../../src/features/device-health/capture-gate', () => ({
  createCaptureGate: () => ({ blocked: false, message: null }),
}))

vi.mock('../../src/features/device-health/device-health-runtime', () => ({
  createDeviceHealthService: vi.fn(),
}))

vi.mock('../../src/features/device-health/device-health-screen', () => ({
  DeviceHealthScreen: () => <div>health</div>,
}))

vi.mock('../../src/features/master/master-sku-screen', () => ({
  MasterSkuScreen: () => <div>master</div>,
}))

vi.mock('../../src/features/supervision/supervision-screen', () => ({
  SupervisionScreen: () => <div>supervision</div>,
}))

vi.mock('../../src/features/cuts/cuts-screen', () => ({
  CutsScreen: () => <div>cuts</div>,
}))

vi.mock('../../src/features/counting/counting-screen', () => ({
  CountingScreen: ({ syncCoordinator }: { syncCoordinator: unknown }) => <div data-testid="sync-state">{syncCoordinator ? 'enabled' : 'disabled'}</div>,
}))

vi.mock('../../src/app/certification-fixture-mode', () => ({
  isCertificationFixtureEnabled: () => false,
}))

import { App } from '../../src/app/App'

describe('App sync bootstrap', () => {
  it('enables sync when health resolves an authorized runtime after the initial cache lookup was empty', async () => {
    const userId = '22222222-2222-4222-8222-222222222222'
    const coordinator = {
      runOutstanding: vi.fn(async () => ({ scopes: 0, claimed: 0, confirmed: 0, rejected: 0, failed: 0, conflicts: 0, diagnostic: null })),
    }
    h.createSyncCoordinator.mockReturnValue(coordinator)
    h.runDeviceHealthCheck.mockResolvedValue({
      report: { resolvedContext: { kind: 'READY' } },
      runtime: { context: { inventoryId: '11111111-1111-4111-8111-111111111111', userId, inventoryStatus: 'ABIERTO' } },
    })

    const view = render(<App />)

    await waitFor(() => expect(h.createSyncCoordinator).toHaveBeenCalledWith(userId))
    await waitFor(() => expect(view.getByTestId('sync-state')).toHaveTextContent('enabled'))
  })
})
