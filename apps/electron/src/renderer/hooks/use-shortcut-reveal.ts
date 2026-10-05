import { useEffect, useState } from 'react'
import { isMac, isWebUI } from '@/lib/platform'

export type RevealModifier = 'metaKey' | 'ctrlKey' | 'altKey'

/**
 * The key that, while held, reveals every shortcut: Option/Alt in the browser
 * (⌘ and Ctrl belong to the browser there), ⌘ in the desktop app on macOS, Ctrl on
 * the other desktop systems.
 */
export function revealModifier(mac: boolean, webui: boolean): RevealModifier {
  if (webui) return 'altKey'
  return mac ? 'metaKey' : 'ctrlKey'
}

/** True while the reveal key is held (reset when the window loses focus). */
export function useShortcutReveal(): boolean {
  const [held, setHeld] = useState(false)

  useEffect(() => {
    const modifier = revealModifier(isMac, isWebUI)
    const sync = (event: KeyboardEvent) => setHeld(event[modifier])
    const reset = () => setHeld(false)
    const resetWhenHidden = () => { if (document.hidden) reset() }

    window.addEventListener('keydown', sync)
    window.addEventListener('keyup', sync)
    window.addEventListener('blur', reset)
    document.addEventListener('visibilitychange', resetWhenHidden)
    return () => {
      window.removeEventListener('keydown', sync)
      window.removeEventListener('keyup', sync)
      window.removeEventListener('blur', reset)
      document.removeEventListener('visibilitychange', resetWhenHidden)
    }
  }, [])

  return held
}
