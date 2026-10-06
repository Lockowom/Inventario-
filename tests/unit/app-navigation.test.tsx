import { fireEvent, render, screen } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'
import { AppNavigation } from '../../src/app/app-navigation'
import { isAppViewAllowed } from '../../src/app/app-navigation-policy'

describe('AppNavigation', () => {
  it('separa los módulos en navegación y permite cambiar de área', () => {
    const select = vi.fn()
    render(<AppNavigation role="ADMIN" activeView="home" onSelect={select} onSignOut={vi.fn()} />)

    fireEvent.click(screen.getByRole('button', { name: 'Abrir menú' }))
    fireEvent.click(screen.getByRole('button', { name: /Conciliación/ }))

    expect(select).toHaveBeenCalledWith('reconciliation')
    expect(screen.getByRole('navigation', { hidden: true })).toHaveAttribute('aria-label', 'Navegación principal')
  })

  it('muestra Usuarios exclusivamente a ADMIN', () => {
    const { rerender } = render(<AppNavigation role="ANALISTA" activeView="home" onSelect={vi.fn()} onSignOut={vi.fn()} />)
    expect(screen.queryByRole('button', { name: /Usuarios/, hidden: true })).not.toBeInTheDocument()

    rerender(<AppNavigation role="ADMIN" activeView="home" onSelect={vi.fn()} onSignOut={vi.fn()} />)
    expect(screen.getByRole('button', { name: /Usuarios/, hidden: true })).toBeInTheDocument()
  })

  it('limita CONTADOR a Inicio y Conteo', () => {
    render(<AppNavigation role="CONTADOR" activeView="home" onSelect={vi.fn()} onSignOut={vi.fn()} />)

    fireEvent.click(screen.getByRole('button', { name: 'Abrir menú' }))

    expect(screen.getByRole('button', { name: /Conteo/ })).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: /Supervisión/ })).not.toBeInTheDocument()
    expect(screen.queryByRole('button', { name: /Conciliación/ })).not.toBeInTheDocument()
    expect(screen.queryByRole('button', { name: /Cortes/ })).not.toBeInTheDocument()
    expect(screen.queryByRole('button', { name: /Maestro SKU/ })).not.toBeInTheDocument()
    expect(screen.queryByRole('button', { name: /Usuarios/ })).not.toBeInTheDocument()
  })

  it('deniega vistas de gestión a CONTADOR aunque un caller intente seleccionarlas', () => {
    expect(isAppViewAllowed('CONTADOR', 'home')).toBe(true)
    expect(isAppViewAllowed('CONTADOR', 'counting')).toBe(true)
    expect(isAppViewAllowed('CONTADOR', 'monitor')).toBe(false)
    expect(isAppViewAllowed('CONTADOR', 'supervision')).toBe(false)
    expect(isAppViewAllowed('CONTADOR', 'reconciliation')).toBe(false)
    expect(isAppViewAllowed('CONTADOR', 'cuts')).toBe(false)
    expect(isAppViewAllowed('CONTADOR', 'users')).toBe(false)
  })
})
