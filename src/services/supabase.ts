import { createClient, type SupabaseClient } from '@supabase/supabase-js'

const url = import.meta.env.VITE_SUPABASE_URL
const anonKey = import.meta.env.VITE_SUPABASE_ANON_KEY

export const isSupabaseConfigured = Boolean(url && anonKey)

let supabaseClient: SupabaseClient | undefined

export function getSupabaseClient(): SupabaseClient | undefined {
  if (!isSupabaseConfigured) return undefined
  supabaseClient ??= createClient(url, anonKey, { auth: { persistSession: true, autoRefreshToken: true } })
  return supabaseClient
}
