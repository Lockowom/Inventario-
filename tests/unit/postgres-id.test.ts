import { describe, expect, it } from 'vitest'
import { postgresUuidSchema } from '../../src/domain/postgres-id'
import { inventorySchema } from '../../src/domain/inventory/contracts'
import { masterMetadataSchema } from '../../src/domain/master/contracts'
import { cachedCountingContextSchema } from '../../src/domain/ports/counting-context-repository'

describe('postgresUuidSchema', () => {
  it('accepts PostgreSQL canonical UUIDs without RFC version or variant semantics', () => {
    expect(postgresUuidSchema.parse('b11b0000-0000-0000-0000-000000000001')).toBe('b11b0000-0000-0000-0000-000000000001')
    expect(postgresUuidSchema.parse('A11B0000-0000-4000-8000-000000000001')).toBe('a11b0000-0000-4000-8000-000000000001')
  })

  it.each(['QA-CUT2-11B-E2E-SYNTHETIC', '123', 'b11b0000', 'b11b0000-0000-0000-0000-00000000000z', 'b11b0000000000000000000000000001', ' b11b0000-0000-0000-0000-000000000001 ', ''])('rejects non-canonical identifiers', (value) => {
    expect(postgresUuidSchema.safeParse(value).success).toBe(false)
  })

  it('uses the PostgreSQL identifier contract for master metadata', () => {
    expect(masterMetadataSchema.safeParse({ inventoryId: 'b11b0000-0000-0000-0000-000000000001', masterVersion: 1, rowCount: 3, fingerprint: 'a'.repeat(64), cachedAt: '2026-11-06T23:20:47.958Z' }).success).toBe(true)
  })

  it('keeps inventory selection and its C1 cache on the same PostgreSQL contract', () => {
    const inventoryId = 'b11b0000-0000-0000-0000-000000000001'
    expect(inventorySchema.safeParse({ id: inventoryId, name: 'QA-CUT2-11B-E2E-SYNTHETIC', status: 'ABIERTO' }).success).toBe(true)
    expect(cachedCountingContextSchema.safeParse({
      userId: '11111111-1111-4111-8111-111111111111',
      inventoryId,
      inventoryStatus: 'ABIERTO',
      verifiedAt: '2026-11-06T23:20:47.958Z',
      authorization: {
        actorId: '11111111-1111-4111-8111-111111111111',
        userType: 'PERMANENT',
        capabilities: ['COUNT_C1'],
        inventoryScopes: [inventoryId],
        warehouseScopes: ['22222222-2222-4222-8222-222222222222'],
        schemaVersion: 1,
      },
    }).success).toBe(true)
  })
})
