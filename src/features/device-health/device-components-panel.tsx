import type { DeviceHealthCheckKey, DeviceHealthReport, HealthCheckStatus } from '../../domain/device-health/contracts'
import { releaseMetadata } from '../../config/release-metadata'
import type { OtaUpdateState } from '../../services/ota-update-service'

type ComponentState = 'LISTO' | 'LISTA' | 'ACTUALIZADO' | 'ONLINE' | 'OFFLINE' | 'DESCARGANDO' | 'ACTUALIZACIÓN DISPONIBLE' | 'NO DISPONIBLE' | 'REQUIERE APK' | 'REVISAR'

function statusFor(report: DeviceHealthReport | null, key: DeviceHealthCheckKey): HealthCheckStatus | null {
  return report?.checks.find((check) => check.key === key)?.status ?? null
}

function checkState(status: HealthCheckStatus | null, ready: ComponentState, unavailable: ComponentState = 'REVISAR'): ComponentState {
  if (status === 'PASS') return ready
  if (status === 'WARN') return unavailable
  if (status === 'UNAVAILABLE') return 'NO DISPONIBLE'
  return 'REVISAR'
}

function scannerState(status: HealthCheckStatus | null): ComponentState {
  if (status === 'PASS') return 'LISTO'
  if (status === 'WARN') return 'DESCARGANDO'
  if (status === 'UNAVAILABLE') return 'NO DISPONIBLE'
  return 'REVISAR'
}

export function DeviceComponentsPanel({ report, loading, error, otaState, onOpenDiagnostic }: {
  report: DeviceHealthReport | null
  loading: boolean
  error: string | null
  otaState: OtaUpdateState | null
  onOpenDiagnostic: () => void
}) {
  const scanner = statusFor(report, 'SCANNER_AVAILABLE')
  const ota: ComponentState = otaState?.kind === 'NATIVE_REQUIRED' ? 'REQUIERE APK' : otaState?.kind === 'READY' ? 'ACTUALIZACIÓN DISPONIBLE' : 'LISTO'
  const health: ComponentState = error || report?.overall === 'BLOCKED' ? 'REVISAR' : loading ? 'DESCARGANDO' : report ? 'LISTO' : 'REVISAR'
  const rows: Array<{ label: string; value: string; state: ComponentState }> = [
    { label: 'Scanner', value: scanner === 'WARN' ? 'Preparando componente; la digitación manual sigue disponible.' : 'Lector de códigos', state: scannerState(scanner) },
    { label: 'Base local', value: 'Outbox durable', state: checkState(statusFor(report, 'LOCAL_DATABASE'), 'LISTA') },
    { label: 'Maestro', value: 'Snapshot local', state: checkState(statusFor(report, 'MASTER_SNAPSHOT'), 'ACTUALIZADO') },
    { label: 'Backend', value: 'Conectividad QA', state: checkState(statusFor(report, 'BACKEND_CONNECTIVITY'), 'ONLINE', 'OFFLINE') },
    { label: 'OTA', value: otaState?.kind === 'READY' ? 'Actualización web lista para aplicar' : releaseMetadata.displayVersion, state: ota },
    { label: 'Device Health', value: error ?? report?.overall ?? 'Comprobación pendiente', state: health },
  ]

  return <section className="device-components" aria-labelledby="device-components-title">
    <p className="eyebrow">Experiencia · estado del dispositivo</p><h1 id="device-components-title">COMPONENTES</h1>
    <p>La protección se ejecuta en segundo plano. La captura sólo se bloquea ante un problema crítico.</p>
    <dl>{rows.map((row) => <div key={row.label}><dt>{row.label}<small>{row.value}</small></dt><dd className={`device-components__state device-components__state--${row.state.toLowerCase().replaceAll(' ', '-')}`}>{row.state}</dd></div>)}</dl>
    <button className="button-secondary" type="button" onClick={onOpenDiagnostic}>VER DIAGNÓSTICO COMPLETO</button>
  </section>
}
