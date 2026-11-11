import { z } from 'zod'
import { appRoleSchema } from '../auth/contracts'
import { postgresUuidSchema } from '../postgres-id'

export const authorizationSnapshotSchema = z.object({
  actorId: postgresUuidSchema,
  userType: z.enum(['PERMANENT', 'CONTRACTOR_3PL', 'TEMPORARY', 'EXTERNAL_AUDITOR']),
  capabilities: z.array(z.string().min(1)).min(1),
  inventoryScopes: z.array(postgresUuidSchema).min(1),
  warehouseScopes: z.array(postgresUuidSchema).min(1),
  schemaVersion: z.literal(1),
})
export type AuthorizationSnapshot = z.infer<typeof authorizationSnapshotSchema>

export const cachedCountingContextSchema = z.object({
  userId: postgresUuidSchema,
  inventoryId: postgresUuidSchema,
  inventoryStatus: z.literal('ABIERTO'),
  // Mirrors PostgREST's PostgreSQL timestamp representation (`+00:00`).
  verifiedAt: z.string().datetime({ offset: true }),
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
