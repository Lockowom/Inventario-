import { useEffect } from 'react'
import type { OtaUpdateState } from '../../services/ota-update-service'
import { interactionSounds } from '../../ui/sound/interaction-sound-service'

export function OtaUpdatePanel({ state }: { state: OtaUpdateState | null }) {
  useEffect(() => { if (state?.kind === 'READY') interactionSounds.playOtaReady() }, [state?.kind])
  if (!state || state.kind === 'UNAVAILABLE' || state.kind === 'IDLE' || state.kind === 'DEFERRED' || state.kind === 'UNASSIGNED' || state.kind === 'UP_TO_DATE') return null
  const error = state.kind === 'ERROR' || state.kind === 'NATIVE_REQUIRED'
  return <section className={`${error ? 'ota-update-panel form-error' : 'ota-update-panel'} ${state.kind === 'NATIVE_REQUIRED' ? 'ota-update-panel--blocking' : ''}`} aria-live="polite">
    <strong>OTA · ANDROID QA · {otaLabel(state.kind)}</strong><p>{state.message}</p>
    {(state.kind === 'CHECKING' || state.kind === 'DOWNLOADING' || state.kind === 'PREPARING' || state.kind === 'APPLYING') && <div className="ota-update-panel__progress" aria-label="Progreso de actualización"><span style={{ width: state.kind === 'DOWNLOADING' ? `${state.progress}%` : undefined }} /></div>}
    {state.kind === 'DOWNLOADING' && <small aria-live="polite">{state.progress}%</small>}
    {state.kind === 'READY' && <small>Se aplicará automáticamente cuando no haya captura activa ni evidencia pendiente.</small>}
    {state.kind === 'ERROR' && state.canRollback && <small>El runtime conserva el último bundle validado y revierte automáticamente si el nuevo bundle no inicia.</small>}
  </section>
}

function otaLabel(kind: OtaUpdateState['kind']) { return ({ CHECKING: 'BUSCANDO', DOWNLOADING: 'DESCARGANDO', PREPARING: 'PREPARANDO', READY: 'LISTA', APPLYING: 'ACTUALIZANDO', ERROR: 'ERROR', NATIVE_REQUIRED: 'ACTUALIZACIÓN REQUERIDA' } as Partial<Record<OtaUpdateState['kind'], string>>)[kind] ?? 'ESTADO' }
