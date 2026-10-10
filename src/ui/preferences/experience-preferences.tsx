/* eslint-disable react-refresh/only-export-components */
import { createContext, useCallback, useContext, useEffect, useMemo, useState, type ReactNode } from 'react'
import { getInteractionCapabilities } from '../capabilities'

export type ExperiencePreferences = {
  motion: 'FULL' | 'REDUCED'
  sounds: boolean
  scanSounds: boolean
  confirmationSounds: boolean
  errorSounds: boolean
  recountSounds: boolean
  gestures: boolean
  volume: number
}

type ExperienceContextValue = { preferences: ExperiencePreferences; update: (next: Partial<ExperiencePreferences>) => void; reset: () => void }
const key = 'inven3.experience.v1'
const ExperienceContext = createContext<ExperienceContextValue | null>(null)

export function defaultExperiencePreferences(): ExperiencePreferences {
  return {
    motion: getInteractionCapabilities().prefersReducedMotion ? 'REDUCED' : 'FULL',
    sounds: true, scanSounds: true, confirmationSounds: true, errorSounds: true, recountSounds: true, gestures: true, volume: 70,
  }
}

function readPreferences(): ExperiencePreferences {
  try {
    const raw = window.localStorage.getItem(key)
    if (!raw) return defaultExperiencePreferences()
    return { ...defaultExperiencePreferences(), ...JSON.parse(raw) as Partial<ExperiencePreferences> }
  } catch { return defaultExperiencePreferences() }
}

export function ExperienceProvider({ children }: { children: ReactNode }) {
  const [preferences, setPreferences] = useState<ExperiencePreferences>(readPreferences)
  useEffect(() => {
    document.documentElement.dataset.motion = preferences.motion.toLowerCase()
    try { window.localStorage.setItem(key, JSON.stringify(preferences)) } catch { /* private storage is optional */ }
  }, [preferences])
  const update = useCallback((next: Partial<ExperiencePreferences>) => setPreferences((current) => ({ ...current, ...next })), [])
  const reset = useCallback(() => setPreferences(defaultExperiencePreferences()), [])
  const value = useMemo(() => ({ preferences, update, reset }), [preferences, reset, update])
  return <ExperienceContext.Provider value={value}>{children}</ExperienceContext.Provider>
}

export function useExperiencePreferences() {
  const value = useContext(ExperienceContext)
  // Feature screens remain independently testable and safely degrade when they
  // are mounted outside the application shell.
  return value ?? { preferences: defaultExperiencePreferences(), update: () => undefined, reset: () => undefined }
}

