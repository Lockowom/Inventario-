/* The provider and its hook must share one private React context instance. */
/* eslint-disable react-refresh/only-export-components */
import { createContext, useCallback, useContext, useEffect, useMemo, useState, type ReactNode } from 'react'
import { SupabaseSupervisionRepository } from '../../services/supabase-supervision-repository'

export type ActiveInventory = { id: string; name: string; status: string }

type ActiveInventoryContextValue = {
  inventories: ActiveInventory[]
  inventoryId: string
  activeInventory: ActiveInventory | null
  loading: boolean
  error: string | null
  selectInventory: (inventoryId: string) => void
  refreshInventories: () => Promise<void>
}

const ActiveInventoryContext = createContext<ActiveInventoryContextValue | null>(null)
const repository = new SupabaseSupervisionRepository()

/** Preserve an authorized selection; otherwise choose the first authorized inventory. */
export function selectAuthorizedInventoryId(currentId: string, inventories: readonly ActiveInventory[]): string {
  return inventories.some((inventory) => inventory.id === currentId) ? currentId : inventories[0]?.id ?? ''
}

export function ActiveInventoryProvider({ children }: { children: ReactNode }) {
  const [inventories, setInventories] = useState<ActiveInventory[]>([])
  const [inventoryId, setInventoryId] = useState('')
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)

  const refreshInventories = useCallback(async () => {
    setLoading(true)
    try {
      const next = await repository.inventories() as ActiveInventory[]
      setInventories(next)
      setInventoryId((current) => selectAuthorizedInventoryId(current, next))
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
    loading,
    error,
    selectInventory: (nextId) => setInventoryId(selectAuthorizedInventoryId(nextId, inventories)),
    refreshInventories,
  }), [error, inventories, inventoryId, loading, refreshInventories])

  return <ActiveInventoryContext.Provider value={value}>{children}</ActiveInventoryContext.Provider>
}

export function useActiveInventory() {
  const value = useContext(ActiveInventoryContext)
  if (!value) throw new Error('ActiveInventoryProvider es requerido para esta vista.')
  return value
}
