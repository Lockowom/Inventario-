import type { LocalCountRecord } from '../domain/count/contracts'
import type { CountSyncGateway } from '../domain/sync/sync-manager'
import { SyncTransportError, type SyncTransportErrorKind } from '../domain/sync/transport-error'
import { getPlatformCapabilities } from '../platform/runtime-platform'
import { getSupabaseClient } from './supabase'

function platform(): 'ANDROID' | 'IOS' | 'WEB' {
  const current = getPlatformCapabilities().platform
  return current === 'android' ? 'ANDROID' : current === 'ios' ? 'IOS' : 'WEB'
}

function clientOrThrow() {
  const client = getSupabaseClient()
  if (!client) throw new SyncTransportError('UNKNOWN_FAIL_CLOSED', 'SYNC_NOT_CONFIGURED')
  return client
}

function property(error: unknown, key: string): unknown {
  return typeof error === 'object' && error !== null ? (error as Record<string, unknown>)[key] : undefined
}

/** Maps transport-specific failures to the stable domain vocabulary. */
export function classifySupabaseSyncError(error: unknown, status?: number): SyncTransportError {
  const code = property(error, 'code')
  const stableCode = typeof code === 'string' ? code : undefined
  const responseStatus = typeof status === 'number' ? status : typeof property(error, 'status') === 'number' ? property(error, 'status') as number : undefined
  const message = typeof property(error, 'message') === 'string' ? property(error, 'message') as string : ''
  let kind: SyncTransportErrorKind = 'UNKNOWN_FAIL_CLOSED'
  let safeCode = 'SYNC_UNKNOWN_ERROR'
  // Authorization takes precedence, then explicit connection failures. Do not
  // collapse all PGRST codes: 000–003 are documented as 503/504 connection errors.
  if (responseStatus === 401 || responseStatus === 403 || stableCode === '42501' || stableCode === 'PGRST301' || stableCode === 'PGRST302' || stableCode === 'PGRST303') { kind = 'TERMINAL_AUTHORIZATION'; safeCode = 'SYNC_AUTHORIZATION_BLOCKED' }
  else if (responseStatus === 502 || responseStatus === 503 || responseStatus === 504 || stableCode === 'PGRST000' || stableCode === 'PGRST001' || stableCode === 'PGRST002' || stableCode === 'PGRST003' || /^(TypeError: )?(Failed to fetch|Load failed|Network request failed|fetch failed)$/i.test(message) || /timeout/i.test(message)) { kind = 'TRANSIENT'; safeCode = 'SYNC_TRANSIENT_UNAVAILABLE' }
  else if (stableCode === '42P01' || stableCode === '42703' || /^PGRST[12]\d{2}$/.test(stableCode ?? '')) { kind = 'TERMINAL_CONTRACT'; safeCode = 'SYNC_CONTRACT_ERROR' }
  return new SyncTransportError(kind, safeCode)
}

const appVersion = import.meta.env.VITE_APP_VERSION ?? '0.1.0'
const deviceLabel = `INVEN3 ${platform()}`

/** Supabase-only adapter. No domain/use-case imports this implementation. */
export class SupabaseSyncGateway implements CountSyncGateway {
  public async registerDevice(input: { deviceId: string }): Promise<void> {
    try {
      const response = await clientOrThrow().rpc('register_sync_device', { p_device_id: input.deviceId, p_platform: platform(), p_app_version: appVersion, p_device_label: deviceLabel })
      const { error, status, statusText } = response
      void statusText
      if (error) throw classifySupabaseSyncError(error, status)
    } catch (error: unknown) { throw error instanceof SyncTransportError ? error : classifySupabaseSyncError(error) }
  }

  public async reportPending(input: { inventoryId: string; deviceId: string; pendingCount: number }): Promise<void> {
    try {
      const response = await clientOrThrow().rpc('report_device_sync_state', { p_inventory_id: input.inventoryId, p_device_id: input.deviceId, p_pending_count: input.pendingCount })
      const { error, status, statusText } = response
      void statusText
      if (error) throw classifySupabaseSyncError(error, status)
    } catch (error: unknown) { throw error instanceof SyncTransportError ? error : classifySupabaseSyncError(error) }
  }

  public async syncBatch(input: { inventoryId: string; deviceId: string; records: LocalCountRecord[] }): Promise<unknown> {
    try {
      const response = await clientOrThrow().rpc('sync_counts', {
      p_inventory_id: input.inventoryId,
      p_device_id: input.deviceId,
      p_platform: platform(),
      p_app_version: appVersion,
      p_device_label: deviceLabel,
      p_records: input.records.map((record) => ({
        client_count_id: record.clientCountId, ubicacion: record.ubicacion, codigo: record.codigo, serie: record.serie, partida: record.partida,
        pieza_producto: record.piezaProducto, fecha_vencimiento: record.fechaVencimiento, talla: record.talla, color: record.color,
        cantidad_contada: record.cantidadContada, captured_at: record.capturedAt,
      })),
      })
      const { data, error, status, statusText } = response
      void statusText
      if (error) throw classifySupabaseSyncError(error, status)
      return data
    } catch (error: unknown) { throw error instanceof SyncTransportError ? error : classifySupabaseSyncError(error) }
  }
}
