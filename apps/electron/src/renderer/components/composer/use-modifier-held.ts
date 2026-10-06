/**
 * True while ⌘ (Ctrl off the Mac) or Option/Alt is held: the composer shows its shortcuts (`Kbd`) only then,
 * never at rest. Any other key pressed with it (the shortcut itself) does not count as holding; letting go, or
 * the window losing focus while it is down, ends it.
 */

import { useEffect, useState } from 'react'
import { isMac } from '@/lib/platform'

/** Whether a key event leaves only the hint modifier down (⌘ / Ctrl, or Option / Alt). */
export function isHintModifier(event: Pick<KeyboardEvent, 'key' | 'metaKey' | 'ctrlKey' | 'altKey' | 'shiftKey'>, mac = isMac): boolean {
  const command = mac ? event.key === 'Meta' : event.key === 'Control'
  return (command || event.key === 'Alt') && !event.shiftKey
}

export function useModifierHeld(): boolean {
  const [held, setHeld] = useState(false)
  useEffect(() => {
    const down = (event: KeyboardEvent) => setHeld(isHintModifier(event))
    const release = () => setHeld(false)
    window.addEventListener('keydown', down)
    window.addEventListener('keyup', release)
    window.addEventListener('blur', release)
    document.addEventListener('visibilitychange', release)
    return () => {
      window.removeEventListener('keydown', down)
      window.removeEventListener('keyup', release)
      window.removeEventListener('blur', release)
      document.removeEventListener('visibilitychange', release)
    }
  }, [])
  return held
}
