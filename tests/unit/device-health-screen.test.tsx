import { fireEvent, render, screen } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'
import { DeviceHealthScreen } from '../../src/features/device-health/device-health-screen'
import { DEVICE_HEALTH_CHECK_KEYS, type DeviceHealthReport } from '../../src/domain/device-health/contracts'

const report = (overall: DeviceHealthReport['overall']): DeviceHealthReport => ({
  mode: 'LIGHT', overall, checkedAt: '2026-09-25T12:00:00.000Z',
  resolvedContext: { kind: 'ONLINE', context: { inventoryId: 'inventory', userId: 'user', inventoryStatus: 'ABIERTO' } },
  checks: DEVICE_HEALTH_CHECK_KEYS.map((key) => ({ key, status: 'PASS', blocking: key === 'AUTH_USER', message: `Mensaje seguro ${key}` })),
})

describe('DeviceHealthScreen', () => {
  it.each([
    ['READY', 'DISPOSITIVO LISTO PARA INVENTARIO'],
    ['READY_OFFLINE', 'DISPOSITIVO LISTO PARA INVENTARIO OFFLINE'],
    ['READY_WITH_WARNINGS', 'DISPOSITIVO LISTO CON ADVERTENCIAS'],
    ['BLOCKED', 'REVISIÓN REQUERIDA'],
  ] as const)('renders the contractual %s label and all eleven checks', (overall, label) => {
    render(<DeviceHealthScreen report={report(overall)} loading={false} error={null} onRefresh={vi.fn()} onFullCheck={vi.fn()} />)
    expect(screen.getByText(label)).toBeInTheDocument()
    expect(screen.getAllByRole('listitem')).toHaveLength(11)
  })

  it('uses controlled LIGHT/FULL callbacks and disables both actions while loading', () => {
    const onRefresh = vi.fn(); const onFullCheck = vi.fn()
    const view = render(<DeviceHealthScreen report={report('READY')} loading={false} error={null} onRefresh={onRefresh} onFullCheck={onFullCheck} />)
    fireEvent.click(screen.getByRole('button', { name: 'ACTUALIZAR' }))
    fireEvent.click(screen.getByRole('button', { name: 'COMPROBAR DISPOSITIVO' }))
    expect(onRefresh).toHaveBeenCalledOnce(); expect(onFullCheck).toHaveBeenCalledOnce()
    view.rerender(<DeviceHealthScreen report={report('READY')} loading error={null} onRefresh={onRefresh} onFullCheck={onFullCheck} />)
    expect(screen.getByRole('button', { name: 'ACTUALIZAR' })).toBeDisabled()
    expect(screen.getByRole('button', { name: 'COMPROBAR DISPOSITIVO' })).toBeDisabled()
  })

  it('shows only the safe runner error', () => {
    render(<DeviceHealthScreen report={null} loading={false} error="No fue posible comprobar el dispositivo. Actualice el diagnóstico antes de capturar." onRefresh={vi.fn()} onFullCheck={vi.fn()} />)
    expect(screen.getByRole('alert')).toHaveTextContent('No fue posible comprobar el dispositivo')
  })
})
