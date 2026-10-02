import { fireEvent, render, screen } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'
import { AppNavigation } from '../../src/app/app-navigation'

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
})
