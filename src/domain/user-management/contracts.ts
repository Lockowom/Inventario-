import { z } from 'zod'
import { appRoleSchema } from '../auth/contracts'

const uuid = z.uuid()
export const managedUserSchema = z.object({
  user_id: uuid,
  email: z.string().email(),
  display_name: z.string().min(1).max(160),
  role: appRoleSchema,
  active: z.boolean(),
  created_at: z.string(),
  updated_at: z.string(),
  inventoryIds: z.array(uuid),
})
export type ManagedUser = z.infer<typeof managedUserSchema>

export const manageableInventorySchema = z.object({ id: uuid, name: z.string(), status: z.string() })
export type ManageableInventory = z.infer<typeof manageableInventorySchema>

export const managedUsersResponseSchema = z.object({ users: z.array(managedUserSchema), inventories: z.array(manageableInventorySchema) })

const password = z.string().min(12, 'La contraseña temporal debe tener al menos 12 caracteres.').max(128)
  .regex(/[a-z]/, 'La contraseña temporal debe incluir una letra minúscula.')
  .regex(/[A-Z]/, 'La contraseña temporal debe incluir una letra mayúscula.')
  .regex(/[0-9]/, 'La contraseña temporal debe incluir un número.')
const shared = z.object({ displayName: z.string().trim().min(1).max(160), role: appRoleSchema, inventoryIds: z.array(uuid).default([]) })
export const createManagedUserSchema = shared.extend({ email: z.string().trim().toLowerCase().email(), password })
export const updateManagedUserSchema = shared.extend({ userId: uuid, active: z.boolean() })
export const setTemporaryPasswordSchema = z.object({ userId: uuid, password })
