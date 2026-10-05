import { useEffect, useRef } from 'react'
import { JUMP_ACTION_IDS, useActionRegistry } from '@/actions'
import { jumpTarget } from '@/atoms/pins-recents'
import { useNavigation } from '@/contexts/navigation-context'
import { useJumpItems } from './use-recents'

/**
 * Bind ⌘1–⌘9 (Option/Alt+1–9 in the browser) to the Nth item of the pinned and recent list.
 * A number with no item is not handled, so the key does what it always did. Mounted once, by the shell.
 */
export function useJumpShortcuts(): void {
  const { register } = useActionRegistry()
  const { navigate } = useNavigation()
  const items = useJumpItems()

  const latest = useRef({ items, navigate })
  useEffect(() => {
    latest.current = { items, navigate }
  })

  useEffect(() => {
    const unregister = JUMP_ACTION_IDS.map((actionId, index) => {
      const target = () => jumpTarget(latest.current.items, index + 1)
      return register({
        actionId,
        enabled: () => target() !== null,
        handler: () => {
          const item = target()
          if (item) void latest.current.navigate(item.route)
        },
      })
    })
    return () => unregister.forEach(fn => fn())
  }, [register])
}
