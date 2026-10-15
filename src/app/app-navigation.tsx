import { useEffect, useState } from 'react'
import type { AppRole } from '../domain/auth/contracts'
import { navigationItemsForRole, type AppView } from './app-navigation-policy'

export type DeviceStatusBadge = 'LISTO' | 'ONLINE' | 'REVISAR' | 'OFFLINE' | 'COMPROBANDO'

export function AppNavigation({ role, activeView, onSelect, onDeviceStatus = () => undefined, onSignOut, deviceNeedsReview = false, deviceStatus }: {
  role: AppRole | null
  activeView: AppView
  onSelect: (view: AppView) => void
  onDeviceStatus?: () => void
  onSignOut: () => void
  deviceNeedsReview?: boolean
  deviceStatus?: DeviceStatusBadge
}) {
  const [open, setOpen] = useState(false)
  const [isDesktop, setIsDesktop] = useState(() => window.matchMedia?.('(min-width: 960px)').matches ?? false)
  const items = navigationItemsForRole(role)

  useEffect(() => {
    const query = window.matchMedia?.('(min-width: 960px)')
    if (!query) return
    const updateViewport = () => setIsDesktop(query.matches)
    updateViewport()
    query.addEventListener('change', updateViewport)
    return () => query.removeEventListener('change', updateViewport)
  }, [])

  useEffect(() => {
    if (!open) return
    const closeOnEscape = (event: KeyboardEvent) => { if (event.key === 'Escape') setOpen(false) }
    window.addEventListener('keydown', closeOnEscape)
    return () => window.removeEventListener('keydown', closeOnEscape)
  }, [open])

  function select(view: AppView) {
    onSelect(view)
    setOpen(false)
  }

  const navigationAvailable = open || isDesktop
  const status = deviceStatus ?? (deviceNeedsReview ? 'REVISAR' : 'LISTO')

  return <>
    <header className="app-topbar">
      <button className="app-menu-toggle" type="button" aria-label="Abrir menú" aria-controls="primary-navigation" aria-expanded={open} onClick={() => setOpen((current) => !current)}>
        <span aria-hidden="true">☰</span><span>MENÚ</span>
      </button>
      <div className="app-topbar__brand"><strong>INVEN3</strong><span>Operación de inventario</span></div>
      <button className={`app-device-status app-device-status--${status.toLowerCase()}`} type="button" aria-label={`Estado del dispositivo: ${status}`} onClick={onDeviceStatus}><span aria-hidden="true">●</span><span>{status}</span></button>
      <button className="app-sign-out" type="button" onClick={onSignOut}>CERRAR SESIÓN</button>
    </header>
    <button className={`app-navigation-backdrop ${open ? 'app-navigation-backdrop--open' : ''}`} type="button" aria-label="Cerrar menú" tabIndex={open ? 0 : -1} onClick={() => setOpen(false)} />
    <nav id="primary-navigation" className={`app-navigation ${open ? 'app-navigation--open' : ''}`} aria-label="Navegación principal" aria-hidden={!navigationAvailable}>
      <div className="app-navigation__header"><span>OPERACIÓN</span>{role && <strong>{role}</strong>}</div>
      <div className="app-navigation__items">
        {items.map((item) => <button key={item.id} className={activeView === item.id ? 'app-navigation__item app-navigation__item--active' : 'app-navigation__item'} type="button" tabIndex={navigationAvailable ? 0 : -1} aria-current={activeView === item.id ? 'page' : undefined} onClick={() => select(item.id)}>
          <strong>{item.label}</strong><span>{item.detail}</span>
        </button>)}
      </div>
      <div className="app-navigation__footer"><button className="app-navigation__sign-out" type="button" tabIndex={navigationAvailable ? 0 : -1} onClick={onSignOut}>CERRAR SESIÓN</button></div>
    </nav>
  </>
}
