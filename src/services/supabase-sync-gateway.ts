import { Capacitor } from '@capacitor/core'
import type { LocalCountRecord } from '../domain/count/contracts'
import type { CountSyncGateway } from '../domain/sync/sync-manager'
import { getSupabaseClient } from './supabase'

function platform(): 'ANDROID' | 'IOS' | 'WEB' {
  const current = Capacitor.getPlatform()
  return current === 'android' ? 'ANDROID' : current === 'ios' ? 'IOS' : 'WEB'
}

function clientOrThrow() {
  const client = getSupabaseClient()
  if (!client) throw new Error('SYNC_NOT_CONFIGURED')
  return client
}

const appVersion = import.meta.env.VITE_APP_VERSION ?? '0.1.0'
const deviceLabel = `INVEN3 ${platform()}`

/** Supabase-only adapter. No domain/use-case imports this implementation. */
export class SupabaseSyncGateway implements CountSyncGateway {
  public async registerDevice(input: { deviceId: string }): Promise<void> {
    const { error } = await clientOrThrow().rpc('register_sync_device', { p_device_id: input.deviceId, p_platform: platform(), p_app_version: appVersion, p_device_label: deviceLabel })
    if (error) throw error
  }

  public async reportPending(input: { inventoryId: string; deviceId: string; pendingCount: number }): Promise<void> {
    const { error } = await clientOrThrow().rpc('report_device_sync_state', { p_inventory_id: input.inventoryId, p_device_id: input.deviceId, p_pending_count: input.pendingCount })
    if (error) throw error
  }

  public async syncBatch(input: { inventoryId: string; deviceId: string; records: LocalCountRecord[] }): Promise<unknown> {
    const { data, error } = await clientOrThrow().rpc('sync_counts', {
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
    if (error) throw error
    return data
  }
}
