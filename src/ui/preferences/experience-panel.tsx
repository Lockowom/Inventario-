import { useState } from 'react'
import { useExperiencePreferences } from './experience-preferences'

export function ExperiencePanel() {
  const [open, setOpen] = useState(false)
  const { preferences, update, reset } = useExperiencePreferences()
  return <aside className="experience-panel" aria-label="Ajustes de experiencia">
    <button className="experience-panel__trigger button-secondary" type="button" aria-expanded={open} onClick={() => setOpen((current) => !current)}>EXPERIENCIA</button>
    {open && <section className="experience-panel__dialog" role="dialog" aria-modal="false" aria-labelledby="experience-title">
      <header><p className="eyebrow">Preferencias locales</p><h2 id="experience-title">EXPERIENCIA</h2><button className="button-secondary" type="button" onClick={() => setOpen(false)}>CERRAR</button></header>
      <fieldset><legend>Animaciones</legend><label><input type="radio" name="motion" checked={preferences.motion === 'FULL'} onChange={() => update({ motion: 'FULL' })}/> Completa</label><label><input type="radio" name="motion" checked={preferences.motion === 'REDUCED'} onChange={() => update({ motion: 'REDUCED' })}/> Reducida</label></fieldset>
      <fieldset><legend>Sonidos</legend><Toggle label="Activar sonidos" checked={preferences.sounds} onChange={(sounds) => update({ sounds })}/><Toggle label="Lecturas" checked={preferences.scanSounds} onChange={(scanSounds) => update({ scanSounds })}/><Toggle label="Confirmaciones" checked={preferences.confirmationSounds} onChange={(confirmationSounds) => update({ confirmationSounds })}/><Toggle label="Errores" checked={preferences.errorSounds} onChange={(errorSounds) => update({ errorSounds })}/><Toggle label="Reconteos" checked={preferences.recountSounds} onChange={(recountSounds) => update({ recountSounds })}/><label className="experience-panel__range">Volumen <output>{preferences.volume}%</output><input type="range" min="0" max="100" value={preferences.volume} onChange={(event) => update({ volume: Number(event.target.value) })}/></label></fieldset>
      <fieldset><legend>Operación táctil</legend><Toggle label="Gestos" checked={preferences.gestures} onChange={(gestures) => update({ gestures })}/></fieldset>
      <button className="button-secondary" type="button" onClick={reset}>RESTABLECER RECOMENDADO</button>
    </section>}
  </aside>
}

function Toggle({ label, checked, onChange }: { label: string; checked: boolean; onChange: (value: boolean) => void }) { return <label><input type="checkbox" checked={checked} onChange={(event) => onChange(event.target.checked)}/> {label}</label> }

