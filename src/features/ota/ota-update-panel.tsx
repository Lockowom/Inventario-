import type { OtaUpdateState } from '../../services/ota-update-service'

export function OtaUpdatePanel({ state, onApply, onRollback }: { state: OtaUpdateState | null; onApply: () => void; onRollback: () => void }) {
  if (!state || state.kind === 'UNAVAILABLE' || state.kind === 'IDLE' || state.kind === 'DEFERRED') return null
  const error = state.kind === 'ERROR' || state.kind === 'NATIVE_REQUIRED'
  return <section className={error ? 'ota-update-panel form-error' : 'ota-update-panel'} aria-live="polite">
    <strong>OTA · ANDROID QA</strong><p>{state.message}</p>
    {state.kind === 'READY' && <button className="button-primary" type="button" onClick={onApply}>APLICAR ACTUALIZACIÓN</button>}
    {state.kind === 'ERROR' && state.canRollback && <button className="button-secondary" type="button" onClick={onRollback}>VOLVER AL ÚLTIMO BUNDLE SEGURO</button>}
  </section>
}
