import { z } from 'zod'

export const inventoryLifecycleSchema = z.enum(['BORRADOR', 'PREPARADO', 'ABIERTO', 'CERRADO', 'CONGELADO'])
export type InventoryLifecycle = z.infer<typeof inventoryLifecycleSchema>

export const inventorySchema = z.object({
  id: z.uuid(),
  name: z.string().trim().min(1),
  status: inventoryLifecycleSchema,
})
export type Inventory = z.infer<typeof inventorySchema>
