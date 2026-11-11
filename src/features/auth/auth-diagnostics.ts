import type { SupabaseRuntimeConfiguration } from '../../services/supabase'

export interface AuthSignInDiagnostic {
  operation: 'SIGN_IN'
  stage: 'UNCONFIGURED' | 'REQUESTING' | 'REJECTED' | 'SUCCEEDED'
  projectRef: string | null
  hostname: string | null
  code: string | null
  status: number | null
  name: string | null
  recordedAt: string
}

export interface AuthInputDiagnostic {
  emailLength: number
  emailTrimChanged: boolean
  passwordLength: number
  passwordUtf8Bytes: number
  passwordHasLeadingSpace: boolean
  passwordHasTrailingSpace: boolean
  passwordContainsNonAscii: boolean
}

let latestSignInDiagnostic: AuthSignInDiagnostic | null = null

/**
 * Keeps QA Auth failures diagnosable without retaining credentials, tokens,
 * emails, server messages, keys, or any other sensitive response fields.
 */
function safeIdentifier(value: unknown): string | null {
  if (typeof value !== 'string') return null
  const normalized = value.trim()
  return /^[A-Za-z][A-Za-z0-9_.-]{0,79}$/.test(normalized) ? normalized : null
}

function safeStatus(value: unknown): number | null {
  return typeof value === 'number' && Number.isInteger(value) && value >= 100 && value <= 599 ? value : null
}

function display(value: string | number | null): string {
  return value === null ? '-' : String(value)
}

/**
 * Capacitor's Android bridge stringifies console arguments independently.
 * Keep this single, scalar-only line intentionally free of credentials,
 * tokens, headers, user input and server-provided messages.
 */
export function formatAuthSignInDiagnostic(diagnostic: AuthSignInDiagnostic): string {
  return `INVEN3_AUTH_SIGN_IN stage=${diagnostic.stage.toLowerCase()} project_ref=${display(diagnostic.projectRef)} host=${display(diagnostic.hostname)} code=${display(diagnostic.code)} status=${display(diagnostic.status)} name=${display(diagnostic.name)}`
}

function isQaDebugBuild(): boolean {
  return import.meta.env.VITE_RELEASE_ENV?.trim().toLowerCase() === 'qa'
}

/**
 * This is deliberately metadata-only. It makes keyboard/autocorrection issues
 * diagnosable without retaining or serializing either credential.
 */
export function formatAuthInputDiagnostic(diagnostic: AuthInputDiagnostic): string {
  return `INVEN3_AUTH_INPUT email_length=${diagnostic.emailLength} email_trim_changed=${diagnostic.emailTrimChanged} password_length=${diagnostic.passwordLength} password_utf8_bytes=${diagnostic.passwordUtf8Bytes} password_leading_space=${diagnostic.passwordHasLeadingSpace} password_trailing_space=${diagnostic.passwordHasTrailingSpace} password_non_ascii=${diagnostic.passwordContainsNonAscii}`
}

export function recordAuthSignInInput(email: string, password: string): AuthInputDiagnostic {
  const diagnostic: AuthInputDiagnostic = {
    emailLength: email.length,
    emailTrimChanged: email !== email.trim(),
    passwordLength: password.length,
    passwordUtf8Bytes: new TextEncoder().encode(password).byteLength,
    passwordHasLeadingSpace: password !== password.trimStart(),
    passwordHasTrailingSpace: password !== password.trimEnd(),
    passwordContainsNonAscii: Array.from(password).some((character) => (character.codePointAt(0) ?? 0) > 0x7f),
  }

  if (isQaDebugBuild()) console.info(formatAuthInputDiagnostic(diagnostic))
  return diagnostic
}

function record(stage: AuthSignInDiagnostic['stage'], configuration: SupabaseRuntimeConfiguration, error?: unknown): AuthSignInDiagnostic {
  const candidate = error as { code?: unknown; status?: unknown; name?: unknown }
  const diagnostic: AuthSignInDiagnostic = {
    operation: 'SIGN_IN',
    stage,
    projectRef: configuration.projectRef,
    hostname: configuration.hostname,
    code: safeIdentifier(candidate?.code),
    status: safeStatus(candidate?.status),
    name: safeIdentifier(candidate?.name),
    recordedAt: new Date().toISOString(),
  }
  latestSignInDiagnostic = diagnostic

  // Logcat gets scalar, stable Auth metadata in QA—never input or secrets.
  if (isQaDebugBuild()) console.info(formatAuthSignInDiagnostic(diagnostic))

  return diagnostic
}

export function recordAuthSignInAttempt(configuration: SupabaseRuntimeConfiguration): AuthSignInDiagnostic {
  return record(configuration.configured ? 'REQUESTING' : 'UNCONFIGURED', configuration)
}

export function recordAuthSignInFailure(configuration: SupabaseRuntimeConfiguration, error: unknown): AuthSignInDiagnostic {
  return record('REJECTED', configuration, error)
}

export function recordAuthSignInSuccess(configuration: SupabaseRuntimeConfiguration): AuthSignInDiagnostic {
  return record('SUCCEEDED', configuration)
}

export function getLatestAuthSignInDiagnostic(): AuthSignInDiagnostic | null {
  return latestSignInDiagnostic
}

export function clearLatestAuthSignInDiagnostic(): void {
  latestSignInDiagnostic = null
}
