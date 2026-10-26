import { z } from 'zod'

export const inventoryCloseBlockerSchema = z.object({
  code: z.string().min(1),
  count: z.number().int().nonnegative(),
  blocks_close: z.literal(true),
})

export const inventoryCloseReadinessSchema = z.object({
  inventory_id: z.uuid(),
  warehouse_id: z.uuid(),
  current_status: z.string(),
  target_status: z.literal('CERRADO'),
  is_ready: z.boolean(),
  fingerprint: z.string().regex(/^[A-Fa-f0-9]{64}$/),
  blocker_codes: z.array(z.string()),
  blockers: z.array(inventoryCloseBlockerSchema),
  blocker_counts: z.record(z.string(), z.number().int().nonnegative()),
  material_summary: z.record(z.string(), z.unknown()),
})

export type InventoryCloseBlocker = z.infer<typeof inventoryCloseBlockerSchema>
export type InventoryCloseReadiness = z.infer<typeof inventoryCloseReadinessSchema>
export type InventoryClosePreview = InventoryCloseReadiness

export const inventoryCloseResultSchema = z.object({
  inventory_id: z.uuid(),
  close_request_id: z.uuid(),
  status: z.literal('CERRADO'),
  fingerprint: z.string().regex(/^[A-Fa-f0-9]{64}$/),
  idempotent: z.boolean(),
})
export type InventoryCloseResult = z.infer<typeof inventoryCloseResultSchema>
