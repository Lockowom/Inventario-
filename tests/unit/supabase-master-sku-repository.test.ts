import { describe, expect, it } from 'vitest'
import { normalizePostgresTimestamp } from '../../src/services/supabase-master-sku-repository'

describe('Supabase master timestamp normalization', () => {
  it('normalizes PostgreSQL offset timestamps to strict UTC ISO', () => {
    expect(normalizePostgresTimestamp('2026-09-26 05:37:24.382693+00'))
      .toBe('2026-09-26T05:37:24.382Z')
    expect(normalizePostgresTimestamp('2026-09-26T05:37:18.429761+00:00'))
      .toBe('2026-09-26T05:37:18.429Z')
  })

  it('rejects invalid remote timestamps', () => {
    expect(() => normalizePostgresTimestamp('not-a-date')).toThrow('Timestamp remoto inválido')
  })
})
