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
  build: string | null
  displayVersion: string
  isProduction: boolean
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
  const version = input.version?.trim() || '1.0.0'
  const build = input.build?.trim() || null
  const override = input.displayVersionOverride?.trim()

  const channelSuffix = channel === 'production' ? '' : `-${channel}`
  const buildSuffix = build ? `+${build}` : ''
  const displayVersion = override || `${version}${channelSuffix}${buildSuffix}`

  return {
    environment,
    channel,
    version,
    build,
    displayVersion,
    isProduction: environment === 'production' || channel === 'production',
  }
}

export const releaseMetadata = resolveReleaseMetadata({
  environment: import.meta.env.VITE_RELEASE_ENV,
  channel: import.meta.env.VITE_RELEASE_CHANNEL,
  version: import.meta.env.VITE_RELEASE_VERSION,
  build: import.meta.env.VITE_APP_BUILD,
  displayVersionOverride: import.meta.env.VITE_APP_VERSION,
})
