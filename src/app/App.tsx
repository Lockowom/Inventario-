import { Capacitor } from '@capacitor/core'
import { useEffect, useState } from 'react'
import { isSupabaseConfigured } from '../services/supabase'
import { MasterSkuScreen } from '../features/master/master-sku-screen'
import { CountingScreen } from '../features/counting/counting-screen'
import { createCountingRuntime } from '../features/counting/counting-runtime'
import { getCountingContextRepository } from '../features/counting/counting-runtime'
import { getLocalSessionUserId, verifyServerCountingContext } from '../features/counting/authorized-counting-context'
import { resolveCountingContext } from '../domain/count/resolve-counting-context'
import { authService } from '../features/auth/auth-service'
import type { CountingRuntime } from '../features/counting/counting-screen'

const version = import.meta.env.VITE_APP_VERSION ?? '0.1.0'

export function App() {
  const [countingRuntime, setCountingRuntime] = useState<CountingRuntime | null>(null)
  useEffect(() => {
    let active = true
    const cache = getCountingContextRepository()
    void resolveCountingContext({ verifyServer: verifyServerCountingContext, getLocalSessionUserId }, cache).then((result) => { if (active) setCountingRuntime(result.kind === 'ONLINE' || result.kind === 'OFFLINE' ? createCountingRuntime(result.context) : null) }).catch(() => { if (active) setCountingRuntime(null) })
    const localSignOut = authService.onLocalSignOut(() => { if (active) setCountingRuntime(null) })
    const authChanges = authService.onAuthStateChange((event) => {
      if (event !== 'SIGNED_OUT') return
      void cache.clear()
      if (active) setCountingRuntime(null)
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
  return <main className="app-shell"><section className="diagnostic" aria-labelledby="app-title"><h1 id="app-title">INVEN3</h1><p className="diagnostic__subtitle">Entorno: {import.meta.env.DEV ? 'Development' : 'Production'}</p><dl className="status-grid">{status.map(([label, value]) => <div className="status-card" key={label}><dt>{label}</dt><dd>{value}</dd></div>)}</dl></section><MasterSkuScreen /><CountingScreen runtime={countingRuntime} /></main>
}
