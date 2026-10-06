/**
 * The composer's draft, in the browser only (docs/data-architecture.md): one per workspace and page context, so
 * changing page swaps the text and coming back finds it. An empty draft is removed, not stored.
 */

import { useCallback, useState } from 'react'
import * as storage from '@/lib/local-storage'

/** The storage suffix of a draft: the workspace, then the context key ('task:<id>', 'page:tasks'). */
export function draftSuffix(workspaceId: string | null | undefined, contextKey: string): string {
  return `${workspaceId ?? 'none'}:${contextKey}`
}

function readDraft(suffix: string): string {
  const value = storage.get<unknown>(storage.KEYS.composerDraft, '', suffix)
  return typeof value === 'string' ? value : ''
}

export function useComposerDraft(workspaceId: string | null | undefined, contextKey: string) {
  const suffix = draftSuffix(workspaceId, contextKey)
  const [draft, setDraft] = useState(() => ({ suffix, text: readDraft(suffix) }))
  // Another context: read its draft during render (no frame shows the old text).
  if (draft.suffix !== suffix) setDraft({ suffix, text: readDraft(suffix) })

  const setText = useCallback((text: string) => {
    setDraft({ suffix, text })
    if (text) storage.set(storage.KEYS.composerDraft, text, suffix)
    else storage.remove(storage.KEYS.composerDraft, suffix)
  }, [suffix])

  return [draft.suffix === suffix ? draft.text : readDraft(suffix), setText] as const
}
