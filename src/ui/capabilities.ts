import { Capacitor } from '@capacitor/core'

export type InteractionCapabilities = {
  isTouch: boolean
  isNativeAndroid: boolean
  supportsAudio: boolean
  prefersReducedMotion: boolean
}

export function getInteractionCapabilities(): InteractionCapabilities {
  const reduced = typeof window !== 'undefined' && window.matchMedia?.('(prefers-reduced-motion: reduce)').matches === true
  const touch = typeof window !== 'undefined' && (window.matchMedia?.('(pointer: coarse)').matches === true || navigator.maxTouchPoints > 0)
  return {
    isTouch: touch,
    isNativeAndroid: Capacitor.getPlatform() === 'android',
    supportsAudio: typeof window !== 'undefined' && (typeof window.AudioContext !== 'undefined' || typeof window.webkitAudioContext !== 'undefined'),
    prefersReducedMotion: reduced,
  }
}

