import { Capacitor } from '@capacitor/core'
import { isSupabaseConfigured } from '../services/supabase'

const version = import.meta.env.VITE_APP_VERSION ?? '0.1.0'

export function App() {
  const platform = Capacitor.getPlatform()
  const status = [
    ['Plataforma', platform === 'web' ? 'Web' : platform],
    ['Storage', 'READY'],
    ['Supabase', isSupabaseConfigured ? 'CONFIGURED' : 'NOT CONFIGURED'],
    ['Versión', version],
  ] as const
  return <main className="app-shell"><section className="diagnostic" aria-labelledby="app-title"><h1 id="app-title">INVEN3</h1><p className="diagnostic__subtitle">Entorno: {import.meta.env.DEV ? 'Development' : 'Production'}</p><dl className="status-grid">{status.map(([label, value]) => <div className="status-card" key={label}><dt>{label}</dt><dd>{value}</dd></div>)}</dl></section></main>
}
