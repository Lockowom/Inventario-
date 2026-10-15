import { getPlatformCapabilities } from '../platform/runtime-platform'

export type InteractionCapabilities = {
  isTouch: boolean
  isNativeAndroid: boolean
  supportsAudio: boolean
  prefersReducedMotion: boolean
}

export function getInteractionCapabilities(): InteractionCapabilities {
  const platform = getPlatformCapabilities()
  const reduced = typeof window !== 'undefined' && window.matchMedia?.('(prefers-reduced-motion: reduce)').matches === true
  const touch = typeof window !== 'undefined' && (window.matchMedia?.('(pointer: coarse)').matches === true || navigator.maxTouchPoints > 0)
  return {
    isTouch: touch,
    isNativeAndroid: platform.isNativeAndroid,
    supportsAudio: typeof window !== 'undefined' && (typeof window.AudioContext !== 'undefined' || typeof window.webkitAudioContext !== 'undefined'),
    prefersReducedMotion: reduced,
  }
}

