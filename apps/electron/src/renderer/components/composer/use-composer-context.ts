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

/** `enabled` false registers nothing (a chat drawn inside another surface). */
export function useComposerContext(context: ComposerContext, enabled = true) {
  const registry = useComposerRegistry()
  const id = useId()
  const { key, entity, placeholder, mode, sessionId, onSend, busy, onStop, tools, chips, imageNotice, structured, canSendEmpty, disabled, workingDirectory, commands } = context
  useLayoutEffect(() => {
    if (enabled) registry?.set(id, { key, entity, placeholder, mode, sessionId, onSend, busy, onStop, tools, chips, imageNotice, structured, canSendEmpty, disabled, workingDirectory, commands })
    else registry?.remove(id)
  }, [registry, id, enabled, key, entity, placeholder, mode, sessionId, onSend, busy, onStop, tools, chips, imageNotice, structured, canSendEmpty, disabled, workingDirectory, commands])
  useLayoutEffect(() => () => registry?.remove(id), [registry, id])
}
