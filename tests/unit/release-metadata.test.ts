import { describe, expect, it } from 'vitest'
import { resolveReleaseMetadata } from '../../src/config/release-metadata'

describe('release metadata', () => {
  it('defaults safely to local development', () => {
    expect(resolveReleaseMetadata({})).toEqual({
      environment: 'local',
      channel: 'development',
      version: '1.0.0',
      build: null,
      displayVersion: '1.0.0-development',
      isProduction: false,
    })
  })

  it('represents a QA beta candidate with build identity', () => {
    expect(resolveReleaseMetadata({
      environment: 'qa',
      channel: 'beta',
      version: '1.0.0',
      build: 'a67c5648',
    })).toMatchObject({
      environment: 'qa',
      channel: 'beta',
      displayVersion: '1.0.0-beta+a67c5648',
      isProduction: false,
    })
  })

  it('marks either production dimension as production', () => {
    expect(resolveReleaseMetadata({ environment: 'production', channel: 'beta' }).isProduction).toBe(true)
    expect(resolveReleaseMetadata({ environment: 'qa', channel: 'production' }).isProduction).toBe(true)
  })

  it('preserves the explicit legacy build display override', () => {
    expect(resolveReleaseMetadata({ displayVersionOverride: 'f9b-ios-qa-38992a0' }).displayVersion)
      .toBe('f9b-ios-qa-38992a0')
  })
})
