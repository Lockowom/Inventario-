import type { ServerTimeGateway } from '../domain/device-health/contracts'
import { getSupabaseClient } from './supabase'

/** Authenticated client gateway; failures are intentionally normalized to unavailable. */
export class SupabaseServerTimeGateway implements ServerTimeGateway {
  public async getServerTime(): Promise<Date | null> {
    const client = getSupabaseClient()
    if (!client) return null
    try {
      const response = await client.rpc('get_server_time')
      if (response.error || typeof response.data !== 'string') return null
      const value = new Date(response.data)
      return Number.isNaN(value.getTime()) ? null : value
    } catch { return null }
  }
}
