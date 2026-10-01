import { Capacitor } from '@capacitor/core'
import { useCallback, useEffect, useRef, useState } from 'react'
import { isSupabaseConfigured } from '../services/supabase'
import { MasterSkuScreen } from '../features/master/master-sku-screen'
import { SupervisionScreen } from '../features/supervision/supervision-screen'
import { CountingScreen } from '../features/counting/counting-screen'
import { CutsScreen } from '../features/cuts/cuts-screen'
import { createCountingRuntime, createSyncCoordinator, getCountingContextRepository } from '../features/counting/counting-runtime'
import { authService } from '../features/auth/auth-service'
import { LoginScreen } from '../features/auth/login-screen'
import { nextRuntimeAuthState, type RuntimeAuthState } from '../features/auth/auth-boundary-state'
import type { CountingRuntime } from '../features/counting/counting-screen'
import type { SyncCoordinator } from '../domain/sync/sync-coordinator'
import type { DeviceHealthMode, DeviceHealthReport } from '../domain/device-health/contracts'
import { createDeviceHealthService } from '../features/device-health/device-health-runtime'
import { DeviceHealthScreen } from '../features/device-health/device-health-screen'
import { runDeviceHealthCheck } from '../features/device-health/device-health-runner'
import { createCaptureGate } from '../features/device-health/capture-gate'
import { CertificationFixture } from './certification-fixture'
import { isCertificationFixtureEnabled } from './certification-fixture-mode'
import { releaseMetadata } from '../config/release-metadata'
import { ReconciliationScreen } from '../features/reconciliation/reconciliation-screen'

export function App() {
  if (isCertificationFixtureEnabled({ dev: import.meta.env.DEV, fixture: import.meta.env.VITE_CERTIFICATION_FIXTURE })) return <CertificationFixture />
  return <RuntimeApp />
}

function RuntimeApp() {
  if (!isSupabaseConfigured) return <main className="app-shell"><InfrastructureDiagnostic supabaseState="NOT CONFIGURED" /></main>
  return <AuthBoundary />
}

function AuthBoundary() {
  const [state, setState] = useState<RuntimeAuthState>('CHECKING')
  useEffect(() => {
    let active = true
    void authService.hasRuntimeIdentity().then((signedIn) => { if (active) setState(signedIn ? 'SIGNED_IN' : 'SIGNED_OUT') }).catch(() => { if (active) setState('SIGNED_OUT') })
    const authChanges = authService.onAuthStateChange((event, session) => {
      if (active) setState((current) => nextRuntimeAuthState(current, event, Boolean(session)))
    })
    const localSignOut = authService.onLocalSignOut(() => { if (active) setState('SIGNED_OUT') })
    return () => { active = false; authChanges.unsubscribe(); localSignOut.unsubscribe() }
  }, [])
  if (state === 'CHECKING') return <main className="app-shell"><InfrastructureDiagnostic supabaseState="CONFIGURED" /><p className="auth-status" role="status">Validando sesión…</p></main>
  if (state === 'SIGNED_OUT') return <LoginScreen onSignedIn={() => setState('SIGNED_IN')} />
  return <AuthenticatedRuntime />
}

function AuthenticatedRuntime() {
  const [countingRuntime, setCountingRuntime] = useState<CountingRuntime | null>(null)
  const [syncCoordinator, setSyncCoordinator] = useState<SyncCoordinator | null>(null)
  const [startupSyncMessage, setStartupSyncMessage] = useState('')
  const [healthReport, setHealthReport] = useState<DeviceHealthReport | null>(null)
  const [healthLoading, setHealthLoading] = useState(true)
  const [healthError, setHealthError] = useState<string | null>(null)
  const healthRun = useRef(0)

  const runHealth = useCallback(async (mode: DeviceHealthMode) => {
    const run = ++healthRun.current
    setHealthLoading(true); setHealthError(null); setHealthReport(null)
    try {
      const result = await runDeviceHealthCheck(mode, { createService: createDeviceHealthService, createCountingRuntime })
      if (run !== healthRun.current) return
      if (result.report.resolvedContext.kind === 'BLOCKED' && result.report.resolvedContext.reason === 'NOT_AUTHORIZED') {
        await authService.invalidateLocalAuthority()
        return
      }
      setHealthReport(result.report); setCountingRuntime(result.runtime)
    } catch (error: unknown) {
      console.error('DEVICE_HEALTH_RUNTIME_FAIL', error)
      if (run !== healthRun.current) return
      setHealthError('No fue posible comprobar el dispositivo. Actualice el diagnóstico antes de capturar.')
    } finally {
      if (run === healthRun.current) setHealthLoading(false)
    }
  }, [])

  useEffect(() => {
    if (!countingRuntime) return
    setSyncCoordinator((current) => current ?? createSyncCoordinator(countingRuntime.context.userId))
  }, [countingRuntime])

  useEffect(() => {
    let active = true
    const cache = getCountingContextRepository()
    const prepareSync = async () => {
      const authorized = await cache.get()
      if (!active || !authorized) return
      const coordinator = createSyncCoordinator(authorized.userId)
      setSyncCoordinator(coordinator)
      void coordinator.runOutstanding().then((summary) => {
        if (!active || summary.scopes === 0) return
        const work = summary.confirmed + summary.rejected + summary.failed
        setStartupSyncMessage(summary.diagnostic ? `Sincronización pendiente requiere revisión: ${summary.diagnostic}.` : work === 0 ? 'Conteos pendientes de sincronización.' : `Sincronización pendiente: ${summary.confirmed} confirmados, ${summary.rejected} requieren revisión, ${summary.failed} para reintentar.`)
      }).catch((error: unknown) => {
        console.error('STARTUP_SYNC_FAIL', error)
        if (active) setStartupSyncMessage('No fue posible reconciliar los conteos pendientes. Permanecen protegidos localmente.')
      })
    }
    const bootstrap = async () => { await prepareSync(); if (active) void runHealth('LIGHT') }
    void bootstrap()
    const localSignOut = authService.onLocalSignOut(() => {
      if (!active) return
      healthRun.current += 1
      setHealthReport(null); setHealthError(null); setHealthLoading(false); setCountingRuntime(null); setSyncCoordinator(null); setStartupSyncMessage('')
      void cache.clear()
    })
    return () => { active = false; localSignOut.unsubscribe() }
  }, [runHealth])

  const captureGate = createCaptureGate(healthReport, healthLoading, healthError)
  return <main className="app-shell">
    <InfrastructureDiagnostic supabaseState="CONFIGURED" />
    <div className="session-actions"><button className="button-secondary" type="button" onClick={() => void authService.signOut()}>CERRAR SESIÓN</button></div>
    <DeviceHealthScreen report={healthReport} loading={healthLoading} error={healthError} onRefresh={() => void runHealth('LIGHT')} onFullCheck={() => void runHealth('FULL')} />
    <SupervisionScreen /><ReconciliationScreen /><CutsScreen /><MasterSkuScreen />
    <CountingScreen runtime={countingRuntime} syncCoordinator={syncCoordinator} startupSyncMessage={startupSyncMessage} captureGate={captureGate} />
  </main>
}

function InfrastructureDiagnostic({ supabaseState }: { supabaseState: 'CONFIGURED' | 'NOT CONFIGURED' }) {
  const platform = Capacitor.getPlatform()
  const status = [['Plataforma', platform === 'web' ? 'Web' : platform], ['Storage', 'READY'], ['Supabase', supabaseState], ['Entorno', releaseMetadata.environment.toUpperCase()], ['Canal', releaseMetadata.channel.toUpperCase()], ['Versión', releaseMetadata.displayVersion]] as const
  return <section className="diagnostic" aria-labelledby="app-title"><h1 id="app-title">INVEN3</h1><p className="diagnostic__subtitle">Modo build: {import.meta.env.DEV ? 'Development' : 'Production'}</p><dl className="status-grid">{status.map(([label, value]) => <div className="status-card" key={label}><dt>{label}</dt><dd>{value}</dd></div>)}</dl></section>
}
