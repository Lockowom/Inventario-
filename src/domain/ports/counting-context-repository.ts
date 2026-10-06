import { z } from 'zod'

export const cachedCountingContextSchema = z.object({
  userId: z.uuid(),
  inventoryId: z.uuid(),
  inventoryStatus: z.enum(['ABIERTO', 'C1_COMPLETADO', 'CONCILIACION_FINAL']),
  verifiedAt: z.string().datetime(),
})
export type CachedCountingContext = z.infer<typeof cachedCountingContextSchema>

/** Stores only last-known authorization metadata, never a token or credential. */
export interface CountingContextRepository {
  get(): Promise<CachedCountingContext | null>
  save(context: CachedCountingContext): Promise<void>
  clear(): Promise<void>
}
