import type { AppRole } from '../domain/auth/contracts'

export type AppView = 'home' | 'device-status' | 'counting' | 'recounts' | 'control-center' | 'monitor' | 'supervision' | 'data-load' | 'reconciliation' | 'cuts' | 'master' | 'users'

export type NavigationItem = { id: AppView; label: string; detail: string }

const counterItems: NavigationItem[] = [
  { id: 'counting', label: 'Conteo', detail: 'Captura de inventario' },
  { id: 'recounts', label: 'Reconteos', detail: 'Misiones ciegas C2/C3' },
]

const analystItems: NavigationItem[] = [
  ...counterItems,
  { id: 'control-center', label: 'Centro de Control', detail: 'Cobertura, actividad y conciliación' },
  { id: 'data-load', label: 'Carga de datos', detail: 'Maestro + referencia RP' },
  { id: 'cuts', label: 'Cortes', detail: 'Cierres y respaldos' },
  { id: 'master', label: 'Maestro SKU', detail: 'Estado y excepciones' },
]

export function navigationItemsForRole(role: AppRole | null): NavigationItem[] {
  if (role === 'CONTADOR') return counterItems
  if (role === 'ANALISTA') return analystItems
  if (role === 'ADMIN') return [...analystItems, { id: 'users', label: 'Usuarios', detail: 'Administración segura' }]
  return []
}

export function isAppViewAllowed(role: AppRole | null, view: AppView): boolean {
  if (view === 'device-status') return role !== null
  return navigationItemsForRole(role).some((item) => item.id === view)
}

export function defaultAppViewForRole(role: AppRole | null): AppView {
  return role === 'ANALISTA' || role === 'ADMIN' ? 'control-center' : 'counting'
}
