import type { ServerCountingContextResult } from '../../domain/count/resolve-counting-context'

type CountingContextFailure = Exclude<ServerCountingContextResult, { kind: 'AUTHORIZED' }>

export interface PostgrestFailureResponse {
  error: unknown
  status: number | undefined
  statusText?: string
}

const invalidSessionCodes = new Set([
  'bad_jwt',
  'no_authorization',
  'session_not_found',
  'session_expired',
  'refresh_token_not_found',
  'refresh_token_already_used',
])

const knownTransportMessages = new Set([
  'TypeError: Failed to fetch',
  'TypeError: Load failed',
  'TypeError: Network request failed',
  'TypeError: fetch failed',
])

function valueOf(error: unknown, key: string): unknown {
  return typeof error === 'object' && error !== null ? (error as Record<string, unknown>)[key] : undefined
}

function stringOf(error: unknown, key: string): string | undefined {
  const value = valueOf(error, key)
  return typeof value === 'string' ? value : undefined
}

function isUnavailableStatus(status: number | undefined): boolean {
  return status === 502 || status === 503 || status === 504
}

/**
 * PostgREST uses status 0 when fetch rejects before an HTTP response exists.
 * Keep this intentionally narrow: aborts and unknown client failures block.
 */
function isExplicitTransportFailure(error: unknown, status: number | undefined): boolean {
  if (status !== undefined && status !== 0) return false
  const name = stringOf(error, 'name')
  const message = stringOf(error, 'message')
  return (name === 'TypeError' && message !== undefined && knownTransportMessages.has(`TypeError: ${message}`)) || (message !== undefined && knownTransportMessages.has(message))
}

/** Auth errors have their own status/code shape; do not reuse PostgREST rules. */
export function classifyAuthError(error: unknown): CountingContextFailure {
  const status = valueOf(error, 'status')
  const code = stringOf(error, 'code')
  if (status === 401 || status === 403 || (code !== undefined && invalidSessionCodes.has(code))) return { kind: 'NOT_AUTHORIZED' }
  if (typeof status === 'number' && isUnavailableStatus(status)) return { kind: 'UNAVAILABLE' }
  if (isExplicitTransportFailure(error, typeof status === 'number' ? status : undefined)) return { kind: 'UNAVAILABLE' }
  return { kind: 'AMBIGUOUS' }
}

/**
 * PostgREST errors do not carry HTTP status on the error object. The response
 * status and stable Postgres/PostgREST code must be evaluated together.
 */
export function classifyPostgrestError({ error, status }: PostgrestFailureResponse): CountingContextFailure {
  const code = stringOf(error, 'code')
  if (status === 401 || status === 403 || code === '42501') return { kind: 'NOT_AUTHORIZED' }
  if (isUnavailableStatus(status)) return { kind: 'UNAVAILABLE' }
  if (isExplicitTransportFailure(error, status)) return { kind: 'UNAVAILABLE' }
  return { kind: 'AMBIGUOUS' }
}
