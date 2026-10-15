import type { ExperiencePreferences } from '../preferences/experience-preferences'

type SoundKind = 'SCAN_SUCCESS' | 'SAVE_SUCCESS' | 'ERROR' | 'WARNING' | 'RECOUNT_ASSIGNED' | 'SYNC_COMPLETE' | 'OTA_READY'
type AudioContextConstructor = typeof AudioContext
declare global { interface Window { webkitAudioContext?: AudioContextConstructor } }

export class InteractionSoundService {
  private context: AudioContext | null = null
  private preferences: ExperiencePreferences | null = null

  configure(preferences: ExperiencePreferences) { this.preferences = preferences }
  async unlock() {
    const Context = window.AudioContext ?? window.webkitAudioContext
    if (!Context) return
    this.context ??= new Context()
    if (this.context.state === 'suspended') await this.context.resume().catch(() => undefined)
  }
  playScanSuccess() { this.play('SCAN_SUCCESS') }
  playSaveSuccess() { this.play('SAVE_SUCCESS') }
  playError() { this.play('ERROR') }
  playWarning() { this.play('WARNING') }
  playRecountAssigned() { this.play('RECOUNT_ASSIGNED') }
  playSyncComplete() { this.play('SYNC_COMPLETE') }
  playOtaReady() { this.play('OTA_READY') }

  private play(kind: SoundKind) {
    const preferences = this.preferences
    if (!preferences?.sounds || preferences.volume <= 0 || !this.context || this.context.state !== 'running') return
    if ((kind === 'SCAN_SUCCESS' && !preferences.scanSounds) || (kind === 'SAVE_SUCCESS' && !preferences.confirmationSounds) || ((kind === 'ERROR' || kind === 'WARNING') && !preferences.errorSounds) || (kind === 'RECOUNT_ASSIGNED' && !preferences.recountSounds)) return
    const notes: Record<SoundKind, readonly [number, number, number]> = {
      SCAN_SUCCESS: [880, 0.055, 0], SAVE_SUCCESS: [660, 0.09, 880], ERROR: [180, 0.14, 140], WARNING: [300, 0.12, 260], RECOUNT_ASSIGNED: [523, 0.12, 784], SYNC_COMPLETE: [660, 0.1, 990], OTA_READY: [440, 0.12, 660],
    }
    const [first, duration, second] = notes[kind]
    this.tone(first, duration)
    if (second) this.tone(second, duration, duration * .7)
  }
  private tone(frequency: number, duration: number, delay = 0) {
    if (!this.context || !this.preferences) return
    const oscillator = this.context.createOscillator(); const gain = this.context.createGain(); const now = this.context.currentTime + delay
    gain.gain.setValueAtTime(0.0001, now); gain.gain.exponentialRampToValueAtTime(Math.max(0.0001, this.preferences.volume / 700), now + .008); gain.gain.exponentialRampToValueAtTime(0.0001, now + duration)
    oscillator.type = 'sine'; oscillator.frequency.setValueAtTime(frequency, now); oscillator.connect(gain); gain.connect(this.context.destination); oscillator.start(now); oscillator.stop(now + duration + .015)
  }
}

export const interactionSounds = new InteractionSoundService()

