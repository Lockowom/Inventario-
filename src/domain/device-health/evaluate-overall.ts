import type { DeviceHealthCheck, DeviceHealthOverall } from './contracts'
import type { ResolvedCountingContext } from '../count/resolve-counting-context'

/** Pure policy evaluator. Authorization semantics remain owned by resolveCountingContext. */
export function evaluateDeviceHealthOverall(checks: readonly DeviceHealthCheck[], context: ResolvedCountingContext): DeviceHealthOverall {
  if (context.kind === 'BLOCKED') return 'BLOCKED'
  if (checks.some((check) => check.blocking && check.status === 'FAIL')) return 'BLOCKED'
  if (context.kind === 'OFFLINE') return 'READY_OFFLINE'
  if (checks.some((check) => check.status !== 'PASS')) return 'READY_WITH_WARNINGS'
  return 'READY'
}
