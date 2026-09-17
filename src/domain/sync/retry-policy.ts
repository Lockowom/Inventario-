/** Capped exponential retry with bounded jitter; timestamps remain UTC ISO strings. */
export function nextRetryAt(attempt: number, now: Date, random: () => number = Math.random): string {
  const exponentialMs = Math.min(300_000, 1_000 * 2 ** Math.max(0, attempt - 1))
  const jitterMs = Math.floor(exponentialMs * 0.25 * Math.max(0, Math.min(1, random())))
  return new Date(now.getTime() + exponentialMs + jitterMs).toISOString()
}
