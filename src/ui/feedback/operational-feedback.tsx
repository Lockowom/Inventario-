export type FeedbackTone = 'IDLE' | 'WORKING' | 'SUCCESS' | 'WARNING' | 'ERROR' | 'OFFLINE' | 'SYNCING'
const label: Record<FeedbackTone, string> = { IDLE: 'LISTO', WORKING: 'VALIDANDO', SUCCESS: 'CONFIRMADO', WARNING: 'REVISIÓN', ERROR: 'ERROR', OFFLINE: 'SIN CONEXIÓN', SYNCING: 'SINCRONIZANDO' }
export function OperationalFeedback({ tone, message, className = '' }: { tone: FeedbackTone; message: string; className?: string }) {
  if (!message) return null
  return <p className={`operational-feedback operational-feedback--${tone.toLowerCase()} ${className}`} role={tone === 'ERROR' ? 'alert' : 'status'} aria-live="polite"><strong>{label[tone]}</strong><span>{message}</span></p>
}
