import { getSupabaseClient } from './supabase'
import type { C1FindingOutboxItem } from '../features/findings/c1-finding-offline-outbox'

function clientOrThrow() {
  const client = getSupabaseClient()
  if (!client) throw new Error('HALLAZGOS_NO_CONFIGURADOS')
  return client
}

/** Narrow product boundary for durable C1 finding evidence. */
export class SupabaseFindingsRepository {
  async reportC1Finding(item: C1FindingOutboxItem): Promise<Record<string, unknown>> {
    const { data, error } = await clientOrThrow().rpc('sync_offline_c1_reference_finding', {
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
    })
    if (error) throw new Error(error.message)
    return data as Record<string, unknown>
  }
}
