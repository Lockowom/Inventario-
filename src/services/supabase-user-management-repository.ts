import type { z } from 'zod'
import { createManagedUserSchema, managedUsersResponseSchema, setTemporaryPasswordSchema, updateManagedUserSchema } from '../domain/user-management/contracts'
import { getSupabaseClient } from './supabase'

type CreateInput = z.infer<typeof createManagedUserSchema>
type UpdateInput = z.infer<typeof updateManagedUserSchema>
type PasswordInput = z.infer<typeof setTemporaryPasswordSchema>

function errorMessage(error: unknown) {
  if (typeof error === 'object' && error !== null && 'error' in error && typeof error.error === 'string') return error.error
  if (error instanceof Error) return error.message
  return 'La administración de usuarios no está disponible.'
}

export class SupabaseUserManagementRepository {
  private client() {
    const client = getSupabaseClient()
    if (!client) throw new Error('Supabase no configurado.')
    return client
  }

  private async invoke<T>(body: Record<string, unknown>): Promise<T> {
    const result = await this.client().functions.invoke('manage-users', { body })
    if (result.error || !result.response?.ok) throw new Error(errorMessage(result.data ?? result.error))
    return result.data as T
  }

  async list() {
    return managedUsersResponseSchema.parse(await this.invoke<unknown>({ action: 'list' }))
  }

  async create(input: CreateInput) {
    const value = createManagedUserSchema.parse(input)
    return this.invoke<unknown>({ action: 'create', ...value })
  }

  async update(input: UpdateInput) {
    const value = updateManagedUserSchema.parse(input)
    return this.invoke<unknown>({ action: 'update', ...value })
  }

  async setTemporaryPassword(input: PasswordInput) {
    const value = setTemporaryPasswordSchema.parse(input)
    await this.invoke<unknown>({ action: 'set_temporary_password', ...value })
  }
}
