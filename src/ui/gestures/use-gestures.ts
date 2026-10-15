import { useCallback, useRef, type PointerEvent, type PointerEventHandler } from 'react'

type SwipeHandlers = { onSwipeLeft?: () => void; onSwipeRight?: () => void; threshold?: number; enabled?: boolean; ignoreSelector?: string }
function isInteractiveTarget(target: EventTarget | null) {
  return target instanceof HTMLElement && Boolean(target.closest('input, textarea, select, button, a, [contenteditable="true"], [role="button"]'))
}
export function useSwipe({ onSwipeLeft, onSwipeRight, threshold = 56, enabled = true, ignoreSelector }: SwipeHandlers) {
  const start = useRef<{ x: number; y: number } | null>(null)
  const onPointerDown = useCallback((event: PointerEvent<HTMLElement>) => { if (enabled && event.pointerType !== 'mouse' && !isInteractiveTarget(event.target) && !(ignoreSelector && event.target instanceof Element && event.target.closest(ignoreSelector))) start.current = { x: event.clientX, y: event.clientY } }, [enabled, ignoreSelector])
  const onPointerUp = useCallback((event: PointerEvent<HTMLElement>) => { const point = start.current; start.current = null; if (!point || !enabled) return; const dx = event.clientX - point.x; const dy = event.clientY - point.y; if (Math.abs(dx) < threshold || Math.abs(dy) > Math.abs(dx) * .75) return; if (dx > 0) onSwipeRight?.(); else onSwipeLeft?.() }, [enabled, onSwipeLeft, onSwipeRight, threshold])
  return { onPointerDown, onPointerUp }
}

export function useLongPress(onLongPress: () => void, { delay = 520, enabled = true }: { delay?: number; enabled?: boolean } = {}) {
  const timer = useRef<number | null>(null)
  const clear = useCallback(() => { if (timer.current !== null) window.clearTimeout(timer.current); timer.current = null }, [])
  const onPointerDown: PointerEventHandler<HTMLElement> = useCallback((event) => { if (!enabled || event.pointerType === 'mouse') return; clear(); timer.current = window.setTimeout(() => { timer.current = null; onLongPress() }, delay) }, [clear, delay, enabled, onLongPress])
  return { onPointerDown, onPointerUp: clear, onPointerCancel: clear, onPointerLeave: clear }
}

