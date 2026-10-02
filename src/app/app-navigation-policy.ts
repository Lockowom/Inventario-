import type { AppRole } from '../domain/auth/contracts'

export type AppView = 'home' | 'counting' | 'supervision' | 'reconciliation' | 'cuts' | 'master' | 'users'

export type NavigationItem = { id: AppView; label: string; detail: string }

const counterItems: NavigationItem[] = [
  { id: 'home', label: 'Inicio', detail: 'Estado del dispositivo' },
  { id: 'counting', label: 'Conteo', detail: 'Captura de inventario' },
]

const analystItems: NavigationItem[] = [
  ...counterItems,
  { id: 'supervision', label: 'Supervisión', detail: 'Seguimiento operativo' },
  { id: 'reconciliation', label: 'Conciliación', detail: 'Diferencias y recuentos' },
  { id: 'cuts', label: 'Cortes', detail: 'Cierres y respaldos' },
  { id: 'master', label: 'Maestro SKU', detail: 'Datos maestros' },
]

export function navigationItemsForRole(role: AppRole | null): NavigationItem[] {
  if (role === 'CONTADOR') return counterItems
  if (role === 'ANALISTA') return analystItems
  if (role === 'ADMIN') return [...analystItems, { id: 'users', label: 'Usuarios', detail: 'Administración segura' }]
  return counterItems.filter((item) => item.id === 'home')
}

export function isAppViewAllowed(role: AppRole | null, view: AppView): boolean {
  return navigationItemsForRole(role).some((item) => item.id === view)
}
