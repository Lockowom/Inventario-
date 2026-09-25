import { Capacitor } from '@capacitor/core'
import { useEffect, useState } from 'react'
import { isSupabaseConfigured } from '../services/supabase'
import { MasterSkuScreen } from '../features/master/master-sku-screen'
import { SupervisionScreen } from '../features/supervision/supervision-screen'
import { CountingScreen } from '../features/counting/counting-screen'
import { CutsScreen } from '../features/cuts/cuts-screen'
import { createCountingRuntime, createSyncCoordinator, getCountingContextRepository } from '../features/counting/counting-runtime'
import { getLocalSessionUserId, verifyServerCountingContext } from '../features/counting/authorized-counting-context'
import { resolveCountingContext } from '../domain/count/resolve-counting-context'
import { authService } from '../features/auth/auth-service'
import type { CountingRuntime } from '../features/counting/counting-screen'
import type { SyncCoordinator } from '../domain/sync/sync-coordinator'
import { CertificationFixture } from './certification-fixture'
import { isCertificationFixtureEnabled } from './certification-fixture-mode'

const version = import.meta.env.VITE_APP_VERSION ?? '0.1.0'

export function App() {
  if (isCertificationFixtureEnabled({ dev: import.meta.env.DEV, fixture: import.meta.env.VITE_CERTIFICATION_FIXTURE })) return <CertificationFixture />
  return <RuntimeApp />
}

function RuntimeApp() {
  const [countingRuntime, setCountingRuntime] = useState<CountingRuntime | null>(null)
  const [syncCoordinator, setSyncCoordinator] = useState<SyncCoordinator | null>(null)
  const [startupSyncMessage, setStartupSyncMessage] = useState('')
  useEffect(() => {
    let active = true
    const cache = getCountingContextRepository()
    void getLocalSessionUserId().then((userId) => {
      if (!active || !userId) return
      const coordinator = createSyncCoordinator(userId)
      setSyncCoordinator(coordinator)
      return coordinator.runOutstanding().then((summary) => {
        if (!active || summary.scopes === 0) return
        const work = summary.confirmed + summary.rejected + summary.failed
        setStartupSyncMessage(summary.diagnostic ? `Sincronización pendiente requiere revisión: ${summary.diagnostic}.` : work === 0 ? 'Conteos pendientes de sincronización.' : `Sincronización pendiente: ${summary.confirmed} confirmados, ${summary.rejected} requieren revisión, ${summary.failed} para reintentar.`)
      }).catch(() => { if (active) setStartupSyncMessage('No fue posible reconciliar los conteos pendientes. Permanecen protegidos localmente.') })
    })
    void resolveCountingContext({ verifyServer: verifyServerCountingContext, getLocalSessionUserId }, cache).then((result) => { if (active) setCountingRuntime(result.kind === 'ONLINE' || result.kind === 'OFFLINE' ? createCountingRuntime(result.context) : null) }).catch(() => { if (active) setCountingRuntime(null) })
    const localSignOut = authService.onLocalSignOut(() => { if (active) { setCountingRuntime(null); setSyncCoordinator(null); setStartupSyncMessage('') } })
    const authChanges = authService.onAuthStateChange((event) => {
      if (event !== 'SIGNED_OUT') return
      void cache.clear()
      if (active) { setCountingRuntime(null); setSyncCoordinator(null); setStartupSyncMessage('') }
    })
    return () => { active = false; localSignOut.unsubscribe(); authChanges.unsubscribe() }
  }, [])
  const platform = Capacitor.getPlatform()
  const status = [
    ['Plataforma', platform === 'web' ? 'Web' : platform],
    ['Storage', 'READY'],
    ['Supabase', isSupabaseConfigured ? 'CONFIGURED' : 'NOT CONFIGURED'],
    ['Versión', version],
  ] as const
  return <main className="app-shell"><section className="diagnostic" aria-labelledby="app-title"><h1 id="app-title">INVEN3</h1><p className="diagnostic__subtitle">Entorno: {import.meta.env.DEV ? 'Development' : 'Production'}</p><dl className="status-grid">{status.map(([label, value]) => <div className="status-card" key={label}><dt>{label}</dt><dd>{value}</dd></div>)}</dl></section><SupervisionScreen /><CutsScreen /><MasterSkuScreen /><CountingScreen runtime={countingRuntime} syncCoordinator={syncCoordinator} startupSyncMessage={startupSyncMessage} /></main>
}
