import { describe, expect, it } from 'vitest'
import { selectAuthorizedInventoryId, selectOperationalInventoryId, type ActiveInventory } from '../../src/features/control-center/active-inventory-context'

const inventories: ActiveInventory[] = [
  { id: 'alpha', name: 'Inventario Alpha', status: 'ABIERTO' },
  { id: 'beta', name: 'Inventario Beta', status: 'CERRADO' },
]

describe('selectAuthorizedInventoryId', () => {
  it('preserva el inventario autorizado que el operador ya seleccionó', () => {
    expect(selectAuthorizedInventoryId('beta', inventories)).toBe('beta')
  })

  it('usa el primer inventario autorizado cuando la selección ya no existe', () => {
    expect(selectAuthorizedInventoryId('revocado', inventories)).toBe('alpha')
  })

  it('no inventa un identificador si el usuario no tiene inventarios autorizados', () => {
    expect(selectAuthorizedInventoryId('alpha', [])).toBe('')
  })
})

describe('selectOperationalInventoryId', () => {
  const open: ActiveInventory[] = [
    { id: 'alpha', name: 'Inventario Alpha', status: 'ABIERTO' },
    { id: 'gamma', name: 'Inventario Gamma', status: 'ABIERTO' },
  ]

  it('no elige arbitrariamente un inventario C1 si existen varios autorizados', () => {
    expect(selectOperationalInventoryId('', open)).toBe('')
  })

  it('preserva sólo la selección activa de la sesión que sigue autorizada', () => {
    expect(selectOperationalInventoryId('gamma', open)).toBe('gamma')
    expect(selectOperationalInventoryId('foreign', open)).toBe('')
  })

  it('selecciona automáticamente cuando el contador sólo tiene un inventario operativo', () => {
    expect(selectOperationalInventoryId('', [open[0]!])).toBe('alpha')
  })
})
