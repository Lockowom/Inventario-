import { z } from 'zod'

// PostgreSQL's uuid type accepts any hexadecimal UUID-shaped value.  The
// seeded warehouse identifier predates RFC-variant enforcement, so the client
// transport contract must preserve that valid database identifier instead of
// rejecting a scoped server response before the UI can render it.
const postgresUuidSchema = z.string().regex(/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i)

export const inventoryCloseBlockerSchema = z.object({
  code: z.string().min(1),
  count: z.number().int().nonnegative(),
  blocks_close: z.literal(true),
})

export const inventoryCloseReadinessSchema = z.object({
  inventory_id: postgresUuidSchema,
  warehouse_id: postgresUuidSchema,
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
  inventory_id: postgresUuidSchema,
  close_request_id: postgresUuidSchema,
  status: z.literal('CERRADO'),
  fingerprint: z.string().regex(/^[A-Fa-f0-9]{64}$/),
  idempotent: z.boolean(),
})
export type InventoryCloseResult = z.infer<typeof inventoryCloseResultSchema>
