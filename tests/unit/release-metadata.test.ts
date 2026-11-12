import { describe, expect, it } from 'vitest'
import { releaseMetadata, resolveReleaseMetadata } from '../../src/config/release-metadata'

describe('release metadata', () => {
  it('defaults safely to local development', () => {
    expect(resolveReleaseMetadata({})).toEqual({
      environment: 'local',
      channel: 'development',
      version: releaseMetadata.appVersion,
      appVersion: releaseMetadata.appVersion,
      nativeVersion: releaseMetadata.nativeVersion,
      versionCode: releaseMetadata.versionCode,
      build: null,
      displayVersion: `${releaseMetadata.appVersion}-development`,
      isProduction: false,
    })
  })

  it('represents a QA beta candidate with build identity', () => {
    expect(resolveReleaseMetadata({
      environment: 'qa',
      channel: 'beta',
      version: '99.99.99.99',
      build: 'a67c5648',
    })).toMatchObject({
      environment: 'qa',
      channel: 'beta',
      version: releaseMetadata.appVersion,
      displayVersion: `${releaseMetadata.appVersion}-beta+a67c5648`,
      isProduction: false,
    })
  })

  it('marks either production dimension as production', () => {
    expect(resolveReleaseMetadata({ environment: 'production', channel: 'beta' }).isProduction).toBe(true)
    expect(resolveReleaseMetadata({ environment: 'qa', channel: 'production' }).isProduction).toBe(true)
  })

  it('does not allow a legacy display override to replace the canonical version', () => {
    expect(resolveReleaseMetadata({ displayVersionOverride: 'f9b-ios-qa-38992a0' }).displayVersion)
      .toBe(`${releaseMetadata.appVersion}-development`)
  })
})
