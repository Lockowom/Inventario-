import { Capacitor } from '@capacitor/core'
import { useEffect, useState } from 'react'
import { isSupabaseConfigured } from '../services/supabase'
import { MasterSkuScreen } from '../features/master/master-sku-screen'
import { CountingScreen } from '../features/counting/counting-screen'
import { createCountingRuntime } from '../features/counting/counting-runtime'
import { loadAuthorizedCountingContext } from '../features/counting/authorized-counting-context'
import type { CountingRuntime } from '../features/counting/counting-screen'

const version = import.meta.env.VITE_APP_VERSION ?? '0.1.0'

export function App() {
  const [countingRuntime, setCountingRuntime] = useState<CountingRuntime | null>(null)
  useEffect(() => {
    let active = true
    void loadAuthorizedCountingContext().then((context) => { if (active) setCountingRuntime(context ? createCountingRuntime(context) : null) }).catch(() => { if (active) setCountingRuntime(null) })
    return () => { active = false }
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
