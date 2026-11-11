/* The provider and its hook must share one private React context instance. */
/* eslint-disable react-refresh/only-export-components */
import { createContext, useCallback, useContext, useEffect, useMemo, useState, type ReactNode } from 'react'
import { SupabaseSupervisionRepository } from '../../services/supabase-supervision-repository'

export type ActiveInventory = { id: string; name: string; status: string }

type ActiveInventoryContextValue = {
  inventories: ActiveInventory[]
  inventoryId: string
  activeInventory: ActiveInventory | null
  /** C1 operational context. It is never auto-picked from several ABIERTO inventories. */
  c1InventoryId: string
  activeC1Inventory: ActiveInventory | null
  operationalInventories: ActiveInventory[]
  loading: boolean
  error: string | null
  selectInventory: (inventoryId: string) => void
  selectC1Inventory: (inventoryId: string) => void
  refreshInventories: () => Promise<void>
}

const ActiveInventoryContext = createContext<ActiveInventoryContextValue | null>(null)
const repository = new SupabaseSupervisionRepository()

/** Preserve an authorized selection; otherwise choose the first authorized inventory. */
export function selectAuthorizedInventoryId(currentId: string, inventories: readonly ActiveInventory[]): string {
  return inventories.some((inventory) => inventory.id === currentId) ? currentId : inventories[0]?.id ?? ''
}

/** A single authorized open inventory is selected automatically; multiple ones require an explicit inventory choice. */
export function selectOperationalInventoryId(currentId: string, inventories: readonly ActiveInventory[]): string {
  if (inventories.some((inventory) => inventory.id === currentId)) return currentId
  return inventories.length === 1 ? inventories[0]?.id ?? '' : ''
}

export function ActiveInventoryProvider({ children }: { children: ReactNode }) {
  const [inventories, setInventories] = useState<ActiveInventory[]>([])
  const [inventoryId, setInventoryId] = useState('')
  const [c1InventoryId, setC1InventoryId] = useState('')
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)

  const refreshInventories = useCallback(async () => {
    setLoading(true)
    try {
      const next = await repository.inventories() as ActiveInventory[]
      const operational = next.filter((inventory) => inventory.status === 'ABIERTO')
      setInventories(next)
      setInventoryId((current) => selectAuthorizedInventoryId(current, next))
      setC1InventoryId((current) => selectOperationalInventoryId(current, operational))
      console.info('INVEN3_CONTEXT AUTHORIZED_INVENTORIES_LOADED')
      setError(null)
    } catch (cause: unknown) {
      setInventories([])
      setInventoryId('')
      setError(cause instanceof Error ? cause.message : 'No fue posible cargar los inventarios autorizados.')
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => { void refreshInventories() }, [refreshInventories])

  const value = useMemo<ActiveInventoryContextValue>(() => ({
    inventories,
    inventoryId,
    activeInventory: inventories.find((inventory) => inventory.id === inventoryId) ?? null,
    c1InventoryId,
    activeC1Inventory: inventories.find((inventory) => inventory.id === c1InventoryId && inventory.status === 'ABIERTO') ?? null,
    operationalInventories: inventories.filter((inventory) => inventory.status === 'ABIERTO'),
    loading,
    error,
    selectInventory: (nextId) => setInventoryId(selectAuthorizedInventoryId(nextId, inventories)),
    selectC1Inventory: (nextId) => {
      if (!inventories.some((inventory) => inventory.id === nextId && inventory.status === 'ABIERTO')) return
      setC1InventoryId(nextId)
      console.info('INVEN3_CONTEXT ACTIVE_INVENTORY_SELECTED')
    },
    refreshInventories,
  }), [c1InventoryId, error, inventories, inventoryId, loading, refreshInventories])

  return <ActiveInventoryContext.Provider value={value}>{children}</ActiveInventoryContext.Provider>
}

export function useActiveInventory() { return useContext(ActiveInventoryContext) }

export function useRequiredActiveInventory() {
  const value = useActiveInventory()
  if (!value) throw new Error('ActiveInventoryProvider es requerido para esta vista.')
  return value
}
