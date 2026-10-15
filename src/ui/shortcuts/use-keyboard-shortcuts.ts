import { useEffect } from 'react'

export type KeyboardShortcut = { key: string; handler: () => void; enabled?: boolean }
function typingTarget(target: EventTarget | null) { return target instanceof HTMLInputElement || target instanceof HTMLTextAreaElement || target instanceof HTMLSelectElement || (target instanceof HTMLElement && target.isContentEditable) }
export function useKeyboardShortcuts(shortcuts: readonly KeyboardShortcut[]) {
  useEffect(() => {
    const listener = (event: KeyboardEvent) => {
      if (event.altKey || event.ctrlKey || event.metaKey || typingTarget(event.target)) return
      const shortcut = shortcuts.find((item) => item.enabled !== false && item.key.toLowerCase() === event.key.toLowerCase())
      if (!shortcut) return
      event.preventDefault(); shortcut.handler()
    }
    window.addEventListener('keydown', listener)
    return () => window.removeEventListener('keydown', listener)
  }, [shortcuts])
}

