import { fireEvent, render, screen } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'
import { AppNavigation } from '../../src/app/app-navigation'
import { defaultAppViewForRole, isAppViewAllowed } from '../../src/app/app-navigation-policy'

describe('AppNavigation', () => {
  it('separa los módulos en navegación y permite cambiar de área', () => {
    const select = vi.fn()
    render(<AppNavigation role="ADMIN" activeView="control-center" onSelect={select} onSignOut={vi.fn()} />)

    fireEvent.click(screen.getByRole('button', { name: 'Abrir menú' }))
    fireEvent.click(screen.getByRole('button', { name: /Centro de Control/ }))

    expect(select).toHaveBeenCalledWith('control-center')
    expect(screen.getByRole('navigation', { hidden: true })).toHaveAttribute('aria-label', 'Navegación principal')
  })

  it('expone Carga de datos a ANALISTA y ADMIN', () => {
    const { rerender } = render(<AppNavigation role="ANALISTA" activeView="control-center" onSelect={vi.fn()} onSignOut={vi.fn()} />)
    expect(screen.getByRole('button', { name: /Carga de datos/, hidden: true })).toBeInTheDocument()
    rerender(<AppNavigation role="ADMIN" activeView="control-center" onSelect={vi.fn()} onSignOut={vi.fn()} />)
    expect(screen.getByRole('button', { name: /Carga de datos/, hidden: true })).toBeInTheDocument()
  })

  it('concentra Monitor, Supervisión y Conciliación bajo Centro de Control', () => {
    render(<AppNavigation role="ANALISTA" activeView="control-center" onSelect={vi.fn()} onSignOut={vi.fn()} />)
    expect(screen.getByRole('button', { name: /Centro de Control/, hidden: true })).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: /Monitor/, hidden: true })).not.toBeInTheDocument()
    expect(screen.queryByRole('button', { name: /Supervisión/, hidden: true })).not.toBeInTheDocument()
    expect(screen.queryByRole('button', { name: /Conciliación/, hidden: true })).not.toBeInTheDocument()
  })

  it('muestra Usuarios exclusivamente a ADMIN', () => {
    const { rerender } = render(<AppNavigation role="ANALISTA" activeView="control-center" onSelect={vi.fn()} onSignOut={vi.fn()} />)
    expect(screen.queryByRole('button', { name: /Usuarios/, hidden: true })).not.toBeInTheDocument()

    rerender(<AppNavigation role="ADMIN" activeView="control-center" onSelect={vi.fn()} onSignOut={vi.fn()} />)
    expect(screen.getByRole('button', { name: /Usuarios/, hidden: true })).toBeInTheDocument()
  })

  it('limita CONTADOR a Conteo y Reconteos, sin Inicio', () => {
    render(<AppNavigation role="CONTADOR" activeView="counting" onSelect={vi.fn()} onSignOut={vi.fn()} />)

    fireEvent.click(screen.getByRole('button', { name: 'Abrir menú' }))

    expect(screen.getByRole('button', { name: /Conteo/ })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: /Reconteos/ })).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: /Inicio/ })).not.toBeInTheDocument()
    expect(screen.queryByRole('button', { name: /Centro de Control/ })).not.toBeInTheDocument()
    expect(screen.queryByRole('button', { name: /Carga de datos/ })).not.toBeInTheDocument()
    expect(screen.queryByRole('button', { name: /Conciliación/ })).not.toBeInTheDocument()
    expect(screen.queryByRole('button', { name: /Cortes/ })).not.toBeInTheDocument()
    expect(screen.queryByRole('button', { name: /Maestro SKU/ })).not.toBeInTheDocument()
    expect(screen.queryByRole('button', { name: /Usuarios/ })).not.toBeInTheDocument()
  })

  it('deniega vistas de gestión a CONTADOR aunque un caller intente seleccionarlas', () => {
    expect(isAppViewAllowed('CONTADOR', 'home')).toBe(false)
    expect(isAppViewAllowed('CONTADOR', 'device-status')).toBe(true)
    expect(isAppViewAllowed('CONTADOR', 'counting')).toBe(true)
    expect(isAppViewAllowed('CONTADOR', 'recounts')).toBe(true)
    expect(isAppViewAllowed('CONTADOR', 'control-center')).toBe(false)
    expect(isAppViewAllowed('CONTADOR', 'monitor')).toBe(false)
    expect(isAppViewAllowed('CONTADOR', 'supervision')).toBe(false)
    expect(isAppViewAllowed('CONTADOR', 'data-load')).toBe(false)
    expect(isAppViewAllowed('CONTADOR', 'reconciliation')).toBe(false)
    expect(isAppViewAllowed('CONTADOR', 'cuts')).toBe(false)
    expect(isAppViewAllowed('CONTADOR', 'master')).toBe(false)
    expect(isAppViewAllowed('CONTADOR', 'users')).toBe(false)
  })

  it('abre Conteo para CONTADOR y Centro de Control para ANALISTA/ADMIN', () => {
    expect(defaultAppViewForRole('CONTADOR')).toBe('counting')
    expect(defaultAppViewForRole('ANALISTA')).toBe('control-center')
    expect(defaultAppViewForRole('ADMIN')).toBe('control-center')
  })

  it('uses a compact device badge and keeps logout available in the drawer', () => {
    const device = vi.fn(); const signOut = vi.fn()
    render(<AppNavigation role="CONTADOR" activeView="counting" onSelect={vi.fn()} onDeviceStatus={device} deviceStatus="OFFLINE" onSignOut={signOut} />)
    fireEvent.click(screen.getByRole('button', { name: 'Estado del dispositivo: OFFLINE' }))
    expect(device).toHaveBeenCalledOnce()
    fireEvent.click(screen.getByRole('button', { name: 'Abrir menú' }))
    const signOutButtons = screen.getAllByRole('button', { name: 'CERRAR SESIÓN' })
    fireEvent.click(signOutButtons.at(-1)!)
    expect(signOut).toHaveBeenCalledOnce()
  })
})
