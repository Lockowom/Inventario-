import { useEffect } from 'react'
import type { OtaUpdateState } from '../../services/ota-update-service'
import { interactionSounds } from '../../ui/sound/interaction-sound-service'

export function OtaUpdatePanel({ state, onApply, onRollback }: { state: OtaUpdateState | null; onApply: () => void; onRollback: () => void }) {
  useEffect(() => { if (state?.kind === 'READY') interactionSounds.playOtaReady() }, [state?.kind])
  if (!state || state.kind === 'UNAVAILABLE' || state.kind === 'IDLE' || state.kind === 'DEFERRED' || state.kind === 'UNASSIGNED' || state.kind === 'UP_TO_DATE') return null
  const error = state.kind === 'ERROR' || state.kind === 'NATIVE_REQUIRED'
  return <section className={`${error ? 'ota-update-panel form-error' : 'ota-update-panel'} ${state.kind === 'NATIVE_REQUIRED' ? 'ota-update-panel--blocking' : ''}`} aria-live="polite">
    <strong>OTA · ANDROID QA · {otaLabel(state.kind)}</strong><p>{state.message}</p>
    {(state.kind === 'CHECKING' || state.kind === 'DOWNLOADING') && <div className="ota-update-panel__progress" aria-label="Progreso de actualización"><span /></div>}
    {state.kind === 'READY' && <button className="button-primary" type="button" onClick={onApply}>APLICAR ACTUALIZACIÓN</button>}
    {state.kind === 'ERROR' && state.canRollback && <button className="button-secondary" type="button" onClick={onRollback}>VOLVER AL ÚLTIMO BUNDLE SEGURO</button>}
  </section>
}

function otaLabel(kind: OtaUpdateState['kind']) { return ({ CHECKING: 'BUSCANDO', DOWNLOADING: 'DESCARGANDO', READY: 'LISTA', ERROR: 'ERROR', NATIVE_REQUIRED: 'ACTUALIZACIÓN REQUERIDA' } as Partial<Record<OtaUpdateState['kind'], string>>)[kind] ?? 'ESTADO' }
