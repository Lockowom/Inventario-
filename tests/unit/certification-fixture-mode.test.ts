import { describe, expect, it } from 'vitest'
import { isCertificationFixtureEnabled } from '../../src/app/certification-fixture-mode'

describe('certification fixture gate', () => {
  it('enables the fixture only for a DEV build with its explicit flag', () => {
    expect(isCertificationFixtureEnabled({ dev: true, fixture: '1' })).toBe(true)
  })

  it('keeps the runtime app for any other DEV flag', () => {
    expect(isCertificationFixtureEnabled({ dev: true, fixture: '0' })).toBe(false)
  })

  it('keeps the runtime app for a production build even with the flag', () => {
    expect(isCertificationFixtureEnabled({ dev: false, fixture: '1' })).toBe(false)
  })
})
