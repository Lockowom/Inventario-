import { describe, expect, it } from 'vitest'
import { formatAuthInputDiagnostic, formatAuthSignInDiagnostic } from '../../src/features/auth/auth-diagnostics'

describe('formatAuthSignInDiagnostic', () => {
  it('emite una sola línea scalar-only apta para Logcat', () => {
    const line = formatAuthSignInDiagnostic({
      operation: 'SIGN_IN',
      stage: 'REJECTED',
      projectRef: 'kpsdephjbvkwvazxubtb',
      hostname: 'kpsdephjbvkwvazxubtb.supabase.co',
      code: 'invalid_credentials',
      status: 400,
      name: 'AuthApiError',
      recordedAt: '2026-11-10T00:00:00.000Z',
    })

    expect(line).toBe('INVEN3_AUTH_SIGN_IN stage=rejected project_ref=kpsdephjbvkwvazxubtb host=kpsdephjbvkwvazxubtb.supabase.co code=invalid_credentials status=400 name=AuthApiError')
    expect(line).not.toContain('[object Object]')
    expect(line).not.toContain('recordedAt')
  })
})

describe('formatAuthInputDiagnostic', () => {
  it('registra sólo métricas no reversibles del payload', () => {
    const line = formatAuthInputDiagnostic({
      emailLength: 29,
      emailTrimChanged: true,
      passwordLength: 10,
      passwordUtf8Bytes: 11,
      passwordHasLeadingSpace: true,
      passwordHasTrailingSpace: false,
      passwordContainsNonAscii: true,
    })

    expect(line).toBe('INVEN3_AUTH_INPUT email_length=29 email_trim_changed=true password_length=10 password_utf8_bytes=11 password_leading_space=true password_trailing_space=false password_non_ascii=true')
    expect(line).not.toContain('@')
    expect(line).not.toContain('[object Object]')
  })
})
