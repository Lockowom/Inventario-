import { describe, expect, it } from 'vitest'
import { compareVersions } from '../../src/services/ota-update-service'

describe('OTA version contract', () => {
  it('never treats an equal or older bundle as an upgrade', () => {
    expect(compareVersions('1.0.0-qa.2', '1.0.0-qa.2')).toBe(0)
    expect(compareVersions('1.0.0-qa.1', '1.0.0-qa.2')).toBeLessThan(0)
    expect(compareVersions('1.0.1-qa.1', '1.0.0-qa.99')).toBeGreaterThan(0)
  })
})
