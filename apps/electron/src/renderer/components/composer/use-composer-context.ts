/**
 * useComposerContext - a page tells the shell composer what it is about, in one line:
 *
 *   useComposerContext({ key: `task:${taskId}`, entity: `task:${taskId}`, placeholder: t('composer.placeholder.task') })
 *
 * Registered on mount (before paint), updated as it changes, removed on unmount; the last page mounted wins.
 * See `ComposerContext` for the fields and docs/composer.md (f).
 */

import { useId, useLayoutEffect } from 'react'
import { useComposerRegistry } from './composer-provider'
import type { ComposerContext } from './composer-state'

export function useComposerContext(context: ComposerContext) {
  const registry = useComposerRegistry()
  const id = useId()
  const { key, entity, placeholder, mode, onSend, busy, onStop, tools } = context
  useLayoutEffect(() => {
    registry?.set(id, { key, entity, placeholder, mode, onSend, busy, onStop, tools })
  }, [registry, id, key, entity, placeholder, mode, onSend, busy, onStop, tools])
  useLayoutEffect(() => () => registry?.remove(id), [registry, id])
}
