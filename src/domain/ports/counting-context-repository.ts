import { z } from 'zod'
import { appRoleSchema } from '../auth/contracts'

export const authorizationSnapshotSchema = z.object({
  actorId: z.uuid(),
  userType: z.enum(['PERMANENT', 'CONTRACTOR_3PL', 'TEMPORARY', 'EXTERNAL_AUDITOR']),
  capabilities: z.array(z.string().min(1)).min(1),
  inventoryScopes: z.array(z.uuid()).min(1),
  warehouseScopes: z.array(z.uuid()).min(1),
  schemaVersion: z.literal(1),
})
export type AuthorizationSnapshot = z.infer<typeof authorizationSnapshotSchema>

export const cachedCountingContextSchema = z.object({
  userId: z.uuid(),
  inventoryId: z.uuid(),
  inventoryStatus: z.literal('ABIERTO'),
  verifiedAt: z.string().datetime(),
  authorization: authorizationSnapshotSchema,
  // Role is display metadata only; authorization is the snapshot above.
  role: appRoleSchema.optional(),
})
export type CachedCountingContext = z.infer<typeof cachedCountingContextSchema>

/** Stores a last-known server verification, never a token or credential. */
export interface CountingContextRepository {
  get(): Promise<CachedCountingContext | null>
  save(context: CachedCountingContext): Promise<void>
  clear(): Promise<void>
}
