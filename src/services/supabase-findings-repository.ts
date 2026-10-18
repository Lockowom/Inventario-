import type { SupabaseClient } from '@supabase/supabase-js'
import { getSupabaseClient } from './supabase'
import type { C1FindingOutboxItem } from '../features/findings/c1-finding-offline-outbox'

function clientOrThrow() {
  const client = getSupabaseClient()
  if (!client) throw new Error('HALLAZGOS_NO_CONFIGURADOS')
  return client
}

/** Narrow product boundary for durable C1 finding evidence. */
export async function syncC1FindingWithClient(client: SupabaseClient, item: C1FindingOutboxItem): Promise<Record<string, unknown>> {
  const payload = {
      p_inventory_id: item.inventoryId,
      p_reference_type: item.referenceType,
      p_codigo: item.codigo,
      p_reference_value: item.referenceValue,
      p_finding_type: item.findingType,
      p_description: item.description,
      p_critical: item.critical,
      p_source_event_key: item.sourceEventKey,
      p_captured_at: item.capturedAt,
      p_evidence: item.evidence,
    }
  const { data, error } = await client.rpc('sync_offline_c1_reference_finding', payload)
  if (error) {
    // The primary RPC is deliberately deny-by-default.  A current
    // authorization failure may preserve the already-captured physical
    // evidence through the narrowly-scoped server review boundary; it can
    // never turn that stale event into an authorized C1 mutation.
    if (/AUTHORIZATION_REVOKED|CAPABILITY_REQUIRED|SCOPE_DENIED|ASSIGNMENT_REVOKED|42501/.test(`${error.code ?? ''} ${error.message}`)) {
      const preserved = await client.rpc('preserve_revoked_offline_c1_finding', payload)
      if (!preserved.error) return preserved.data as Record<string, unknown>
    }
    throw new Error(error.message)
  }
  return data as Record<string, unknown>
}

export class SupabaseFindingsRepository {
  async reportC1Finding(item: C1FindingOutboxItem): Promise<Record<string, unknown>> {
    return syncC1FindingWithClient(clientOrThrow(), item)
  }
}
