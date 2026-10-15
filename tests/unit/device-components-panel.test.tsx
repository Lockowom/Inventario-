import { fireEvent, render, screen } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'
import { DEVICE_HEALTH_CHECK_KEYS, type DeviceHealthReport } from '../../src/domain/device-health/contracts'
import { DeviceComponentsPanel } from '../../src/features/device-health/device-components-panel'

function report(scanner: 'PASS' | 'WARN' | 'UNAVAILABLE' = 'PASS'): DeviceHealthReport {
  return {
    mode: 'LIGHT', overall: 'READY', checkedAt: '2026-10-08T12:00:00.000Z',
    resolvedContext: { kind: 'ONLINE', context: { inventoryId: 'inventory', userId: 'user', inventoryStatus: 'ABIERTO' } },
    checks: DEVICE_HEALTH_CHECK_KEYS.map((key) => ({ key, status: key === 'SCANNER_AVAILABLE' ? scanner : 'PASS', blocking: false, message: key })),
  }
}

describe('DeviceComponentsPanel', () => {
  it('makes the scanner, local outbox, master, backend, OTA and health visible without blocking capture', () => {
    render(<DeviceComponentsPanel report={report()} loading={false} error={null} otaState={{ kind: 'UP_TO_DATE', message: 'Actualizado' }} onOpenDiagnostic={vi.fn()} />)
    expect(screen.getByRole('heading', { name: 'COMPONENTES' })).toBeVisible()
    expect(screen.getByText('Scanner')).toBeVisible()
    expect(screen.getByText('Base local')).toBeVisible()
    expect(screen.getByText('Maestro')).toBeVisible()
    expect(screen.getByText('Backend')).toBeVisible()
    expect(screen.getByText('OTA')).toBeVisible()
    expect(screen.getAllByText('LISTO').length).toBeGreaterThan(1)
  })

  it('explains scanner preparation and keeps a diagnostic action available', () => {
    const onOpenDiagnostic = vi.fn()
    render(<DeviceComponentsPanel report={report('WARN')} loading={false} error={null} otaState={{ kind: 'UP_TO_DATE', message: 'Actualizado' }} onOpenDiagnostic={onOpenDiagnostic} />)
    expect(screen.getByText('DESCARGANDO')).toBeVisible()
    expect(screen.getByText(/digitación manual sigue disponible/i)).toBeVisible()
    fireEvent.click(screen.getByRole('button', { name: 'VER DIAGNÓSTICO COMPLETO' }))
    expect(onOpenDiagnostic).toHaveBeenCalledOnce()
  })

  it('makes native OTA requirements explicit rather than silently failing scanner/manual operation', () => {
    render(<DeviceComponentsPanel report={report('UNAVAILABLE')} loading={false} error={null} otaState={{ kind: 'NATIVE_REQUIRED', minNativeVersion: '1.0.1', message: 'APK requerida' }} onOpenDiagnostic={vi.fn()} />)
    expect(screen.getByText('NO DISPONIBLE')).toBeVisible()
    expect(screen.getByText('REQUIERE APK')).toBeVisible()
  })
})
