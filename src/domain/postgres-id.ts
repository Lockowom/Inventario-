import { z } from 'zod'

/** PostgreSQL accepts every canonical 128-bit UUID; it does not require RFC version/variant bits. */
export const postgresUuidSchema = z.string()
  .regex(/^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}$/, 'Invalid PostgreSQL UUID')
  .transform((value) => value.toLowerCase())
