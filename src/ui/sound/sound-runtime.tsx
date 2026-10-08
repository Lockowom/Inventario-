import { useEffect } from 'react'
import { interactionSounds } from './interaction-sound-service'
import { useExperiencePreferences } from '../preferences/experience-preferences'

export function SoundRuntime() {
  const { preferences } = useExperiencePreferences()
  useEffect(() => { interactionSounds.configure(preferences) }, [preferences])
  useEffect(() => {
    const unlock = () => { void interactionSounds.unlock() }
    window.addEventListener('pointerdown', unlock, { once: true }); window.addEventListener('keydown', unlock, { once: true })
    return () => { window.removeEventListener('pointerdown', unlock); window.removeEventListener('keydown', unlock) }
  }, [])
  return null
}

