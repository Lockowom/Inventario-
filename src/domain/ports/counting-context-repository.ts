import { z } from 'zod'
import { appRoleSchema } from '../auth/contracts'

export const cachedCountingContextSchema = z.object({
  userId: z.uuid(),
  inventoryId: z.uuid(),
  inventoryStatus: z.literal('ABIERTO'),
  verifiedAt: z.string().datetime(),
  // Old offline leases remain readable after the app upgrade. A new online
  // verification always persists the server-verified role below.
  role: appRoleSchema.optional(),
})
export type CachedCountingContext = z.infer<typeof cachedCountingContextSchema>

/** Stores only last-known authorization metadata, never a token or credential. */
export interface CountingContextRepository {
  get(): Promise<CachedCountingContext | null>
  save(context: CachedCountingContext): Promise<void>
  clear(): Promise<void>
}
