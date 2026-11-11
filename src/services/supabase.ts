import { createClient, type SupabaseClient } from '@supabase/supabase-js'

const url = import.meta.env.VITE_SUPABASE_URL
const anonKey = import.meta.env.VITE_SUPABASE_ANON_KEY

export const isSupabaseConfigured = Boolean(url && anonKey)

export interface SupabaseRuntimeConfiguration {
  configured: boolean
  hostname: string | null
  projectRef: string | null
}

export function getSupabaseRuntimeConfiguration(): SupabaseRuntimeConfiguration {
  if (!url || !anonKey) return { configured: false, hostname: null, projectRef: null }
  try {
    const hostname = new URL(url).hostname
    const projectRef = hostname.endsWith('.supabase.co') ? hostname.slice(0, -'.supabase.co'.length) : null
    return { configured: true, hostname, projectRef }
  } catch {
    return { configured: false, hostname: null, projectRef: null }
  }
}

let supabaseClient: SupabaseClient | undefined

export function getSupabaseClient(): SupabaseClient | undefined {
  if (!isSupabaseConfigured) return undefined
  supabaseClient ??= createClient(url, anonKey, { auth: { persistSession: true, autoRefreshToken: true } })
  return supabaseClient
}
