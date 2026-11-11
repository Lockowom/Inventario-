import canonicalVersion from '../../version.json'

export type ReleaseEnvironment = 'local' | 'qa' | 'production'
export type ReleaseChannel = 'development' | 'beta' | 'production'

export interface ReleaseMetadataInput {
  environment?: string
  channel?: string
  version?: string
  build?: string
  displayVersionOverride?: string
}

export interface ReleaseMetadata {
  environment: ReleaseEnvironment
  channel: ReleaseChannel
  version: string
  versionCode: number
  build: string | null
  displayVersion: string
  isProduction: boolean
}

export function displayReleaseChannel(metadata: Pick<ReleaseMetadata, 'environment' | 'channel'>): string {
  if (metadata.environment === 'qa' && metadata.channel === 'beta') return 'QA-BETA'
  return metadata.channel.toUpperCase()
}

function normalizeEnvironment(value?: string): ReleaseEnvironment {
  const normalized = value?.trim().toLowerCase()
  if (normalized === 'qa' || normalized === 'production') return normalized
  return 'local'
}

function normalizeChannel(value?: string): ReleaseChannel {
  const normalized = value?.trim().toLowerCase()
  if (normalized === 'beta' || normalized === 'production') return normalized
  return 'development'
}

export function resolveReleaseMetadata(input: ReleaseMetadataInput): ReleaseMetadata {
  const environment = normalizeEnvironment(input.environment)
  const channel = normalizeChannel(input.channel)
  // Functional release identity is intentionally not configurable at runtime.
  // Channel/build can vary, but Web, Android and device reporting always share
  // the Git-versioned source of truth.
  const version = canonicalVersion.version
  const build = input.build?.trim() || null
  void input.version
  void input.displayVersionOverride

  const channelSuffix = channel === 'production' ? '' : `-${channel}`
  const buildSuffix = build ? `+${build}` : ''
  const displayVersion = `${version}${channelSuffix}${buildSuffix}`

  return {
    environment,
    channel,
    version,
    versionCode: canonicalVersion.versionCode,
    build,
    displayVersion,
    isProduction: environment === 'production' || channel === 'production',
  }
}

export const releaseMetadata = resolveReleaseMetadata({
  environment: import.meta.env.VITE_RELEASE_ENV,
  channel: import.meta.env.VITE_RELEASE_CHANNEL,
  build: import.meta.env.VITE_APP_BUILD,
})
