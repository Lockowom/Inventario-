import { describe, expect, it } from 'vitest'
import { resolveCountSku } from '../../src/domain/count/resolve-count-sku'
import { selectAuthorizedCountingContext } from '../../src/features/counting/authorized-counting-context'
import { getCapacityStatus } from '../../src/features/counting/capacity-status'
import { consumeRestoredScannerResult, processRestoredScannerResult, type ScannerIntentStore } from '../../src/scanner/scanner-restoration'
import type { MasterSkuRepository } from '../../src/domain/ports/master-sku-repository'
import type { PhysicalCountDraft } from '../../src/domain/count/contracts'

const inventoryId = '11111111-1111-4111-8111-111111111111'
const userId = '22222222-2222-4222-8222-222222222222'
const draft: PhysicalCountDraft = { ubicacion: 'F-32-03', codigo: '', serie: 'OLD', partida: '0001', cantidadContada: '4' }
const masters: MasterSkuRepository = {
  findByCode: async (_inventory, code) => code === 'SERIE-S' ? { inventoryId, codigo: code, descripcion: 'Serial local', controlType: 'SERIAL', cachedAt: '2026-09-16T00:00:00.000Z' } : code === 'PARTIDA-P' ? { inventoryId, codigo: code, descripcion: 'Partida local', controlType: 'PARTIDA', cachedAt: '2026-09-16T00:00:00.000Z' } : null,
  listByInventory: async () => [], getMetadata: async () => null, replaceSnapshot: async () => undefined,
}

describe('correcciones de revisión Fase 3', () => {
  it('usa el mismo resolver local para scanner/manual SERIAL y limpia campos incompatibles', async () => {
    await expect(resolveCountSku(inventoryId, ' serie-s ', draft, masters)).resolves.toMatchObject({ master: { controlType: 'SERIAL' }, draft: { codigo: 'SERIE-S', serie: '', partida: '', cantidadContada: '1' }, error: null })
  })
  it('resuelve PARTIDA y reporta código desconocido sin guardar', async () => {
    await expect(resolveCountSku(inventoryId, 'partida-p', draft, masters)).resolves.toMatchObject({ master: { controlType: 'PARTIDA' }, draft: { codigo: 'PARTIDA-P', cantidadContada: '' }, error: null })
    await expect(resolveCountSku(inventoryId, 'desconocido', draft, masters)).resolves.toMatchObject({ master: null, error: 'Código mal ingresado' })
  })
  it.each([[40, 'WARNING', 'varios conteos'], [45, 'CRITICAL', 'Advertencia crítica'], [50, 'BLOCKED', 'GUARDAR está bloqueado']])('muestra capacidad %i como %s sin depender de color', (pending, capacity, text) => {
    const status = getCapacityStatus(pending)
    expect(status.capacity).toBe(capacity)
    expect(status.message).toContain(text)
  })
  it('bloquea contextos que no provienen de exactamente un inventario ABIERTO', () => {
    expect(selectAuthorizedCountingContext(userId, [{ id: inventoryId, status: 'CERRADO' }])).toBeNull()
    expect(selectAuthorizedCountingContext(userId, [{ id: inventoryId, status: 'ABIERTO' }, { id: '33333333-3333-4333-8333-333333333333', status: 'ABIERTO' }])).toBeNull()
    expect(selectAuthorizedCountingContext(userId, [{ id: inventoryId, status: 'ABIERTO' }])).toMatchObject({ userId, inventoryStatus: 'ABIERTO' })
  })
  it('procesa appRestoredResult sin guardar automáticamente y conserva el campo', () => {
    const values = new Map<string, string>([['inven3.pending-scan-field', 'codigo']])
    const store: ScannerIntentStore = { getItem: (key) => values.get(key) ?? null, setItem: (key, value) => values.set(key, value), removeItem: (key) => values.delete(key) }
    expect(processRestoredScannerResult({ pluginId: 'BarcodeScanner', methodName: 'scan', success: true, data: { barcodes: [{ displayValue: 'SERIE-S' }] } }, store)).toEqual({ field: 'codigo', value: 'SERIE-S', error: null })
    expect(values.get('inven3.pending-scan-field')).toBeUndefined()
    expect(consumeRestoredScannerResult(store)).toEqual({ field: 'codigo', value: 'SERIE-S', error: null })
  })
})
