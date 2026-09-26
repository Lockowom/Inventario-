import type { DeviceHealthReport } from '../../domain/device-health/contracts'
import type { CaptureGate } from '../counting/counting-screen'

/** UI-only gate: health never removes a valid read/sync runtime on its own. */
export function createCaptureGate(report: DeviceHealthReport | null, loading: boolean, error: string | null): CaptureGate {
  if (loading) return { blocked: true, message: 'Comprobando el estado del dispositivo…' }
  if (error) return { blocked: true, message: error }
  if (report?.overall === 'BLOCKED') return { blocked: true, message: 'Captura bloqueada por Health Check. Revise los controles marcados como FAIL.' }
  return { blocked: false, message: null }
}
