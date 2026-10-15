import type { DeviceHealthCheckKey, DeviceHealthReport } from '../../domain/device-health/contracts'

const overallLabels = {
  READY: 'DISPOSITIVO LISTO PARA INVENTARIO',
  READY_OFFLINE: 'DISPOSITIVO LISTO PARA INVENTARIO OFFLINE',
  READY_WITH_WARNINGS: 'DISPOSITIVO LISTO CON ADVERTENCIAS',
  BLOCKED: 'REVISIÓN REQUERIDA',
} as const

const checkLabels: Record<DeviceHealthCheckKey, string> = {
  APP_VERSION: 'Versión de la aplicación',
  AUTH_USER: 'Usuario',
  INVENTORY_CONTEXT: 'Inventario',
  MASTER_SNAPSHOT: 'Maestro SKU',
  LOCAL_DATABASE: 'Base local',
  LOCAL_STORAGE: 'Almacenamiento local',
  BACKEND_CONNECTIVITY: 'Conectividad con servidor',
  DEVICE_TIME: 'Hora del dispositivo',
  CAMERA_AVAILABLE: 'Cámara',
  CAMERA_PERMISSION: 'Permiso de cámara',
  SCANNER_AVAILABLE: 'Scanner',
}

export function DeviceHealthScreen({ report, loading, error, onRefresh, onFullCheck }: {
  report: DeviceHealthReport | null
  loading: boolean
  error: string | null
  onRefresh: () => void
  onFullCheck: () => void
}) {
  const overall = report?.overall
  const statusText = error ?? (loading ? 'Comprobando el estado del dispositivo…' : overall ? overallLabels[overall] : 'No fue posible comprobar el dispositivo. Actualice el diagnóstico antes de capturar.')
  const statusRole = error || overall === 'BLOCKED' ? 'alert' : 'status'
  return <section className="device-health-screen" aria-labelledby="device-health-title">
    <header><p className="eyebrow">Diagnóstico operativo</p><h1 id="device-health-title">HEALTH CHECK DEL DISPOSITIVO</h1></header>
    <p className={`device-health-overall${overall === 'BLOCKED' || error ? ' device-health-overall--blocked' : ''}`} role={statusRole}>{statusText}</p>
    {report && <>
      <dl className="device-health-summary"><div><dt>Hora del check</dt><dd><time dateTime={report.checkedAt}>{new Date(report.checkedAt).toLocaleString()}</time></dd></div><div><dt>Modo</dt><dd>{report.mode}</dd></div></dl>
      <ul className="device-health-checks" aria-label="Controles del dispositivo">
        {report.checks.map((check) => <li key={check.key}><div><strong>{checkLabels[check.key]}</strong><span className={`device-health-check__status device-health-check__status--${check.status.toLowerCase()}`}>{check.status}</span></div><p>{check.message}</p></li>)}
      </ul>
    </>}
    <div className="device-health-actions"><button className="button-secondary" type="button" disabled={loading} onClick={onRefresh}>ACTUALIZAR</button><button className="button-primary" type="button" disabled={loading} onClick={onFullCheck}>COMPROBAR DISPOSITIVO</button></div>
  </section>
}

