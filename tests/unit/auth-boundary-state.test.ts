import { describe, expect, it } from 'vitest'
import { nextRuntimeAuthState } from '../../src/features/auth/auth-boundary-state'

describe('AuthBoundary state transitions', () => {
  it('keeps an authenticated runtime on transient null INITIAL_SESSION', () => {
    expect(nextRuntimeAuthState('SIGNED_IN', 'INITIAL_SESSION', false)).toBe('SIGNED_IN')
  })

  it('keeps an authenticated runtime on transient null TOKEN_REFRESHED', () => {
    expect(nextRuntimeAuthState('SIGNED_IN', 'TOKEN_REFRESHED', false)).toBe('SIGNED_IN')
  })

  it('leaves runtime only on an authoritative SIGNED_OUT event', () => {
    expect(nextRuntimeAuthState('SIGNED_IN', 'SIGNED_OUT', false)).toBe('SIGNED_OUT')
  })

  it('enters runtime whenever Supabase supplies a valid session', () => {
    expect(nextRuntimeAuthState('SIGNED_OUT', 'SIGNED_IN', true)).toBe('SIGNED_IN')
  })
})
