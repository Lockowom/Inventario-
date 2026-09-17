import { describe, expect, it } from 'vitest'
import { resolveCountingContext, type CountingContextVerifier } from '../../src/domain/count/resolve-counting-context'
import { signOutAndClearCountingContext } from '../../src/domain/count/sign-out-counting-context'
import type { CachedCountingContext, CountingContextRepository } from '../../src/domain/ports/counting-context-repository'
import { savePhysicalCount } from '../../src/domain/count/save-physical-count'
import type { LocalCountRecord, PhysicalCountDraft } from '../../src/domain/count/contracts'
import type { CountListFilter, CountRepository } from '../../src/domain/ports/count-repository'
import type { MasterSkuRepository } from '../../src/domain/ports/master-sku-repository'
import { DexieCountingContextRepository } from '../../src/storage/web-indexeddb/dexie-counting-context-repository'
import { Inven3WebDatabase } from '../../src/storage/web-indexeddb/inven3-web-database'
import { SqliteCountingContextRepository } from '../../src/storage/mobile-sqlite/sqlite-counting-context-repository'
import type { SqliteDatabase, SqliteResult } from '../../src/storage/mobile-sqlite/sqlite-database'

const inventoryId = '11111111-1111-4111-8111-111111111111'
const otherInventoryId = '33333333-3333-4333-8333-333333333333'
const userId = '22222222-2222-4222-8222-222222222222'
const otherUserId = '44444444-4444-4444-8444-444444444444'
const cached: CachedCountingContext = { userId, inventoryId, inventoryStatus: 'ABIERTO', verifiedAt: '2026-09-16T12:00:00.000Z' }

class MemoryContextRepository implements CountingContextRepository {
  public value: CachedCountingContext | null = null
  public async get() { return this.value }
  public async save(context: CachedCountingContext) { this.value = context }
  public async clear() { this.value = null }
}

function verifier(result: Awaited<ReturnType<CountingContextVerifier['verifyServer']>>, localUserId: string | null = userId): CountingContextVerifier {
  return { verifyServer: async () => result, getLocalSessionUserId: async () => localUserId }
}

describe('last known authorized counting context', () => {
  it('guarda el contexto tras una autorización online', async () => {
    const cache = new MemoryContextRepository()
    await expect(resolveCountingContext(verifier({ kind: 'AUTHORIZED', context: { userId, inventoryId, inventoryStatus: 'ABIERTO' }, verifiedAt: cached.verifiedAt }), cache)).resolves.toMatchObject({ kind: 'ONLINE' })
    expect(cache.value).toEqual(cached)
  })

  it('reemplaza el contexto anterior con la última autorización online', async () => {
    const cache = new MemoryContextRepository(); cache.value = cached
    await resolveCountingContext(verifier({ kind: 'AUTHORIZED', context: { userId, inventoryId: otherInventoryId, inventoryStatus: 'ABIERTO' }, verifiedAt: '2026-09-16T13:00:00.000Z' }), cache)
    expect(cache.value).toMatchObject({ inventoryId: otherInventoryId, verifiedAt: '2026-09-16T13:00:00.000Z' })
  })

  it.each(['NOT_AUTHORIZED', 'AMBIGUOUS'] as const)('una respuesta %s del servidor limpia cache y bloquea', async (kind) => {
    const cache = new MemoryContextRepository(); cache.value = cached
    await expect(resolveCountingContext(verifier({ kind }), cache)).resolves.toEqual({ kind: 'BLOCKED', reason: kind })
    expect(cache.value).toBeNull()
  })

  it('no reutiliza un ABIERTO antiguo cuando el servidor informa que el inventario está CERRADO', async () => {
    const cache = new MemoryContextRepository(); cache.value = cached
    await expect(resolveCountingContext(verifier({ kind: 'NOT_AUTHORIZED' }), cache)).resolves.toEqual({ kind: 'BLOCKED', reason: 'NOT_AUTHORIZED' })
    expect(cache.value).toBeNull()
  })

  it('permite runtime offline sólo con backend UNAVAILABLE, cache válida y el mismo usuario local', async () => {
    const cache = new MemoryContextRepository(); cache.value = cached
    await expect(resolveCountingContext(verifier({ kind: 'UNAVAILABLE' }), cache)).resolves.toEqual({ kind: 'OFFLINE', context: { userId, inventoryId, inventoryStatus: 'ABIERTO' } })
  })

  it('bloquea indisponibilidad sin contexto persistido', async () => {
    await expect(resolveCountingContext(verifier({ kind: 'UNAVAILABLE' }), new MemoryContextRepository())).resolves.toEqual({ kind: 'BLOCKED', reason: 'CACHE_MISMATCH' })
  })

  it('bloquea indisponibilidad cuando la sesión local pertenece a otro usuario', async () => {
    const cache = new MemoryContextRepository(); cache.value = cached
    await expect(resolveCountingContext(verifier({ kind: 'UNAVAILABLE' }, otherUserId), cache)).resolves.toEqual({ kind: 'BLOCKED', reason: 'CACHE_MISMATCH' })
  })

  it('el logout limpia el contexto aunque la salida remota falle', async () => {
    const cache = new MemoryContextRepository(); cache.value = cached
    await expect(signOutAndClearCountingContext(async () => { throw new Error('red caída') }, cache)).rejects.toThrow('red caída')
    expect(cache.value).toBeNull()
  })
})

describe('adaptadores persistentes del contexto', () => {
  it('SQLite v5 conserva el contexto a través de una nueva instancia', async () => {
    const database = new ContextSqliteDatabase()
    await new SqliteCountingContextRepository(database).save(cached)
    await expect(new SqliteCountingContextRepository(database).get()).resolves.toEqual(cached)
    expect(database.userVersion).toBe(5)
  })

  it('Dexie v4 conserva el contexto después de simular un reinicio de app', async () => {
    const databaseName = `inven3-context-restart-${crypto.randomUUID()}`
    const firstDatabase = new Inven3WebDatabase(databaseName)
    await new DexieCountingContextRepository(firstDatabase).save(cached)
    firstDatabase.close()
    const restartedDatabase = new Inven3WebDatabase(databaseName)
    await expect(new DexieCountingContextRepository(restartedDatabase).get()).resolves.toEqual(cached)
    restartedDatabase.close()
    await restartedDatabase.delete()
  })
})

describe('captura offline después de reiniciar', () => {
  it('con cache válida, maestro local y servidor indisponible guarda PENDING sin red', async () => {
    const cache = new MemoryContextRepository(); cache.value = cached
    const resolved = await resolveCountingContext(verifier({ kind: 'UNAVAILABLE' }), cache)
    expect(resolved.kind).toBe('OFFLINE')
    if (resolved.kind === 'BLOCKED') throw new Error('El contexto offline debía estar permitido')
    const counts = new MemoryCountRepository()
    const masters: MasterSkuRepository = { findByCode: async () => ({ inventoryId, codigo: '00001', descripcion: 'Maestro local', controlType: 'PARTIDA', cachedAt: cached.verifiedAt }), listByInventory: async () => [], getMetadata: async () => null, replaceSnapshot: async () => undefined }
    const draft: PhysicalCountDraft = { ubicacion: 'F-32-03', codigo: '00001', partida: '000045', cantidadContada: '2' }
    await expect(savePhysicalCount(resolved.context, draft, { masters, counts, now: () => new Date(cached.verifiedAt), createUuid: (() => { const ids = ['55555555-5555-4555-8555-555555555555', '66666666-6666-4666-8666-666666666666']; return () => ids.shift()! })() })).resolves.toMatchObject({ record: { syncStatus: 'PENDING' } })
    expect(counts.records).toHaveLength(1)
  })
})

class ContextSqliteDatabase implements SqliteDatabase {
  public userVersion = 0
  private context: { user_id: string; inventory_id: string; inventory_status: 'ABIERTO'; verified_at: string } | null = null
  public async initialize(): Promise<void> {}
  public async close(): Promise<void> {}
  public async transaction<T>(operation: () => Promise<T>): Promise<T> { return operation() }
  public async execute(statement: string, values: readonly unknown[] = []): Promise<void> {
    if (statement.startsWith('pragma user_version =')) { this.userVersion = Number(statement.split('=').at(-1)); return }
    if (statement.startsWith('delete from local_counting_context')) { this.context = null; return }
    if (statement.startsWith('insert into local_counting_context')) { this.context = { user_id: String(values[0]), inventory_id: String(values[1]), inventory_status: values[2] as 'ABIERTO', verified_at: String(values[3]) } }
  }
  public async query<Row extends Record<string, unknown>>(statement: string): Promise<SqliteResult<Row>> {
    if (statement === 'pragma user_version') return { values: [{ user_version: this.userVersion }] as unknown as Row[] }
    return { values: (this.context ? [{ ...this.context }] : []) as unknown as Row[] }
  }
}

class MemoryCountRepository implements CountRepository {
  public records: LocalCountRecord[] = []
  public async getOrCreateDeviceId(userId: string) { void userId; return '77777777-7777-4777-8777-777777777777' }
  public async save(record: LocalCountRecord) { this.records.push(record); return record }
  public async savePendingWithCapacity(record: LocalCountRecord) { this.records.push(record); return { record, pending: this.records.length } }
  public async findByClientId(id: string) { return this.records.find((record) => record.clientCountId === id) ?? null }
  public async listOwnCounts(filter: CountListFilter) { void filter; return this.records }
  public async countPendingByDevice() { return this.records.length }
  public async listOutstandingSyncScopes(userId: string) { return [...new Set(this.records.filter((record) => record.userId === userId && record.syncStatus !== 'CONFIRMED' && record.syncStatus !== 'REJECTED').map((record) => record.inventoryId))].map((inventoryId) => ({ inventoryId, userId })) }
  public async countOutstandingByInventoryDevice(inventoryId: string, deviceId: string) { return this.records.filter((record) => record.inventoryId === inventoryId && record.deviceId === deviceId && record.syncStatus !== 'CONFIRMED' && record.syncStatus !== 'REJECTED').length }
  public async claimNextSyncBatch() { return [] }
  public async recoverStaleSyncing() { return 0 }
  public async applySyncAcknowledgements() { return undefined }
  public async markSyncFailed() { return undefined }
}
