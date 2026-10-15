import { describe, expect, it } from 'vitest'
import { selectAuthorizedInventoryId, type ActiveInventory } from '../../src/features/control-center/active-inventory-context'

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
