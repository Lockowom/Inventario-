import { z } from 'zod'

export const appRoleSchema = z.enum(['CONTADOR', 'ANALISTA', 'ADMIN'])
export type AppRole = z.infer<typeof appRoleSchema>

export const profileSchema = z.object({
  user_id: z.uuid(),
  display_name: z.string().min(1),
  role: appRoleSchema,
  active: z.boolean(),
  created_at: z.string(),
  updated_at: z.string(),
})
export type Profile = z.infer<typeof profileSchema>
