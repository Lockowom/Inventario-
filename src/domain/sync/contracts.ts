import { z } from 'zod'

export const SYNC_BATCH_SIZE = 20
export const syncResultStatusSchema = z.enum(['ACCEPTED', 'ALREADY_ACCEPTED', 'CONFLICT', 'REJECTED'])
export type SyncResultStatus = z.infer<typeof syncResultStatusSchema>

const syncServerTimestampSchema = z.string()
  .refine((value) => !Number.isNaN(new Date(value).getTime()), 'Invalid server timestamp')
  .transform((value) => new Date(value).toISOString())

export const syncRpcResultSchema = z.object({
  client_count_id: z.uuid(),
  result_status: syncResultStatusSchema,
  server_count_id: z.uuid().nullable(),
  received_at: syncServerTimestampSchema.nullable(),
  reason: z.string().nullable(),
})
export type SyncRpcResult = z.infer<typeof syncRpcResultSchema>

/** The only acknowledgement shape allowed to mutate a local claimed record. */
export interface LocalSyncAcknowledgement {
  clientCountId: string
  syncStatus: 'CONFIRMED' | 'REJECTED'
  serverCountId: string | null
  receivedAt: string | null
  reason: string | null
}

export interface SyncRunSummary {
  claimed: number
  confirmed: number
  rejected: number
  failed: number
  conflicts: number
  /** Safe diagnostic for a terminal transport condition; no raw backend error. */
  diagnostic: string | null
}
