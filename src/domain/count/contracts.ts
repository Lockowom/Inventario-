import { z } from 'zod'

export const countSyncStatusSchema = z.enum(['LOCAL', 'PENDING', 'SYNCING', 'CONFIRMED', 'FAILED', 'REJECTED'])
export type CountSyncStatus = z.infer<typeof countSyncStatusSchema>

export const countRecordSchema = z.object({
  clientCountId: z.uuid(),
  inventoryId: z.uuid(),
  userId: z.uuid(),
  capturedAt: z.iso.datetime(),
  status: countSyncStatusSchema,
})
export type CountRecord = z.infer<typeof countRecordSchema>
