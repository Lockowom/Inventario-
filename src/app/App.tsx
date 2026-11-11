import { useCallback, useEffect, useRef, useState } from 'react'
import { isSupabaseConfigured } from '../services/supabase'
import { MasterSkuScreen } from '../features/master/master-sku-screen'
import { DataLoadScreen } from '../features/data-load/data-load-screen'
import { SupervisionScreen } from '../features/supervision/supervision-screen'
import { LiveMonitorScreen } from '../features/live-monitor/live-monitor-screen'
import { CountingScreen } from '../features/counting/counting-screen'
import { CutsScreen } from '../features/cuts/cuts-screen'
import { RpReleaseScreen } from '../features/rp-release/rp-release-screen'
import { createCountingRuntime, createSyncCoordinator, getCountingContextRepository } from '../features/counting/counting-runtime'
import { authService } from '../features/auth/auth-service'
import { LoginScreen } from '../features/auth/login-screen'
import { nextRuntimeAuthState, type RuntimeAuthState } from '../features/auth/auth-boundary-state'
import type { CountingRuntime } from '../features/counting/counting-screen'
import type { SyncCoordinator } from '../domain/sync/sync-coordinator'
import { CertificationFixture } from './certification-fixture'
import { isCertificationFixtureEnabled } from './certification-fixture-mode'
import { displayReleaseChannel, releaseMetadata } from '../config/release-metadata'
import { ReconciliationScreen } from '../features/reconciliation/reconciliation-screen'
import { RecountQueueScreen } from '../features/reconciliation/recount-queue-screen'
import { UserManagementScreen } from '../features/user-management/user-management-screen'
import type { AppRole } from '../domain/auth/contracts'
import { AppNavigation } from './app-navigation'
import { defaultAppViewForRole, isAppViewAllowed, type AppView } from './app-navigation-policy'
import { bindOtaRetryEvents, otaUpdateService, type OtaUpdateState } from '../services/ota-update-service'
import { OtaUpdatePanel } from '../features/ota/ota-update-panel'
import { ActiveInventoryProvider, useRequiredActiveInventory } from '../features/control-center/active-inventory-context'
import { ControlCenterScreen } from '../features/control-center/control-center-screen'
import { ExperienceProvider } from '../ui/preferences/experience-preferences'
import { ExperiencePanel } from '../ui/preferences/experience-panel'
import { SoundRuntime } from '../ui/sound/sound-runtime'
import { getPlatformCapabilities } from '../platform/runtime-platform'
import { resolveC1Readiness, type C1Readiness } from '../features/counting/c1-readiness'

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
    // A successful JS launch is reported before any auth or backend work so
    // the native updater can automatically recover a broken OTA bundle.
    void otaUpdateService.notifyLaunchReady().catch(() => undefined)
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
  return <ExperienceProvider><SoundRuntime /><ActiveInventoryProvider><AuthenticatedWorkspace /></ActiveInventoryProvider></ExperienceProvider>
}

function AuthenticatedWorkspace() {
  const { c1InventoryId, operationalInventories, activeC1Inventory, loading: inventoriesLoading, error: inventoryError, selectC1Inventory } = useRequiredActiveInventory()
  const [role, setRole] = useState<AppRole | null>(null)
  const [activeView, setActiveView] = useState<AppView>('counting')
  const [countingRuntime, setCountingRuntime] = useState<CountingRuntime | null>(null)
  const [syncCoordinator, setSyncCoordinator] = useState<SyncCoordinator | null>(null)
  const [startupSyncMessage, setStartupSyncMessage] = useState('')
  const [c1Readiness, setC1Readiness] = useState<C1Readiness | null>(null)
  const [c1Loading, setC1Loading] = useState(true)
  const [otaState, setOtaState] = useState<OtaUpdateState | null>(null)
  const readinessRun = useRef(0)

  const refreshC1Readiness = useCallback(async (activeInventoryId?: string) => {
    const run = ++readinessRun.current
    setC1Loading(true); setC1Readiness(null); setCountingRuntime(null)
    try {
      const readiness = await resolveC1Readiness(activeInventoryId)
      if (run !== readinessRun.current) return
      setC1Readiness(readiness)
      if (readiness.kind === 'C1_READY') setCountingRuntime(createCountingRuntime(readiness.context))
    } catch {
      if (run !== readinessRun.current) return
      setC1Readiness({ kind: 'CONTEXT_UNAVAILABLE', message: 'No fue posible validar el contexto operativo. Reintenta.' })
    } finally {
      if (run === readinessRun.current) setC1Loading(false)
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
    const bootstrap = async () => { await prepareSync() }
    void bootstrap()
    const localSignOut = authService.onLocalSignOut(() => {
      if (!active) return
      readinessRun.current += 1
      setC1Readiness(null); setC1Loading(false); setCountingRuntime(null); setSyncCoordinator(null); setStartupSyncMessage('')
      void cache.clear()
    })
    return () => { active = false; localSignOut.unsubscribe() }
  }, [])

  // C1 resolves only its operational dependencies after the authorized
  // inventory list is available. Hardware diagnostics never gate this flow.
  useEffect(() => {
    if (inventoriesLoading) return
    void refreshC1Readiness(c1InventoryId || undefined)
  }, [c1InventoryId, inventoriesLoading, refreshC1Readiness])

  useEffect(() => {
    // Some isolated runtime tests provide only the auth capabilities they exercise.
    // A real AuthService always provides getRole; treating its absence as no ADMIN is fail-closed.
    const getRole = authService.getRole
    if (typeof getRole !== 'function') return
    void getRole.call(authService).then((nextRole) => { setRole(nextRole); setActiveView(defaultAppViewForRole(nextRole)) }).catch(async () => {
      // The active context is an offline lease issued by the server. Reuse
      // only its last server-verified role; never infer ADMIN while offline.
      const cached = await getCountingContextRepository().get().catch(() => null)
      const cachedRole = cached?.role ?? null
      setRole(cachedRole)
      if (cachedRole) setActiveView(defaultAppViewForRole(cachedRole))
    })
  }, [])

  useEffect(() => {
    let active = true
    const refreshOta = () => { setOtaState({ kind: 'CHECKING', message: 'Buscando una actualización OTA compatible…' }); void otaUpdateService.check().then((next) => { if (active) setOtaState(next) }) }
    refreshOta()
    const stopRetryEvents = bindOtaRetryEvents((listener) => authService.onAuthStateChange((event) => listener(event)), refreshOta)
    return () => { active = false; stopRetryEvents() }
  }, [])

  useEffect(() => {
    if (role && !isAppViewAllowed(role, activeView)) setActiveView(defaultAppViewForRole(role))
  }, [activeView, role])

  const visibleView = isAppViewAllowed(role, activeView) ? activeView : defaultAppViewForRole(role)
  const content = visibleView === 'counting'
      ? <CountingScreen runtime={countingRuntime} syncCoordinator={syncCoordinator} startupSyncMessage={startupSyncMessage} readiness={c1Readiness} readinessLoading={c1Loading} inventoryContext={{ inventories: operationalInventories, inventoryId: c1InventoryId, activeInventory: activeC1Inventory, loading: inventoriesLoading, error: inventoryError, selectInventory: selectC1Inventory }} />
      : visibleView === 'recounts'
        ? <RecountQueueScreen />
      : visibleView === 'control-center'
        ? <ControlCenterScreen role={role} />
      : visibleView === 'monitor'
        ? <LiveMonitorScreen />
        : visibleView === 'supervision'
        ? <SupervisionScreen />
        : visibleView === 'data-load'
          ? <DataLoadScreen role={role} />
        : visibleView === 'reconciliation'
          ? <ReconciliationScreen />
          : visibleView === 'cuts'
            ? <CutsScreen />
            : visibleView === 'rp-release'
              ? <RpReleaseScreen />
            : visibleView === 'master'
              ? <MasterSkuScreen />
              : <UserManagementScreen role={role} />

  return <main className="app-shell app-shell--authenticated">
    <AppNavigation role={role} activeView={visibleView} onSelect={(view) => { if (isAppViewAllowed(role, view)) setActiveView(view) }} onSignOut={() => void authService.signOut()} />
    <section className="app-workspace" aria-label="Área de trabajo"><OtaUpdatePanel state={otaState} onApply={() => void otaUpdateService.apply().then((next) => { if (next) setOtaState(next) })} onRollback={() => void otaUpdateService.rollback()} />{content}</section>
    <ExperiencePanel />
  </main>
}

function InfrastructureDiagnostic({ supabaseState }: { supabaseState: 'CONFIGURED' | 'NOT CONFIGURED' }) {
  const capabilities = getPlatformCapabilities()
  const platform = capabilities.platform
  const storage = capabilities.hasCertifiedDurableStorage ? 'READY' : 'PENDIENTE WIN-06'
  const status = [['Plataforma', platform === 'web' ? 'Web' : platform], ['Storage', storage], ['Supabase', supabaseState], ['Entorno', releaseMetadata.environment.toUpperCase()], ['Canal', displayReleaseChannel(releaseMetadata)], ['Versión', releaseMetadata.displayVersion]] as const
  return <section className="diagnostic" aria-labelledby="app-title"><h1 id="app-title">INVEN3</h1><p className="diagnostic__subtitle">Modo build: {import.meta.env.DEV ? 'Development' : 'Production'}</p><dl className="status-grid">{status.map(([label, value]) => <div className="status-card" key={label}><dt>{label}</dt><dd>{value}</dd></div>)}</dl></section>
}
