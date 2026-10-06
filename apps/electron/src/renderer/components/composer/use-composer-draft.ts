/**
 * The composer's draft, in the browser only (docs/data-architecture.md): one per workspace and page context, so
 * coming back to a page finds its text. The text follows the composer: moving to a page with no draft of its own
 * (opening a chat from a task, going back to a list) takes it along, so the bar growing into the full composer
 * never loses what you typed. An empty draft is removed, not stored.
 */

import { useCallback, useState } from 'react'
import * as storage from '@/lib/local-storage'

/** The storage suffix of a draft: the workspace, then the context key ('task:<id>', 'page:tasks'). */
export function draftSuffix(workspaceId: string | null | undefined, contextKey: string): string {
  return `${workspaceId ?? 'none'}:${contextKey}`
}

/** The text on arriving at a page: its own draft, else (in the same workspace) the text you came with. */
export function arrivingDraft(saved: string, current: string, sameWorkspace: boolean): string {
  return saved || (sameWorkspace ? current : '')
}

function readDraft(suffix: string): string {
  const value = storage.get<unknown>(storage.KEYS.composerDraft, '', suffix)
  return typeof value === 'string' ? value : ''
}

function writeDraft(suffix: string, text: string) {
  if (text) storage.set(storage.KEYS.composerDraft, text, suffix)
  else storage.remove(storage.KEYS.composerDraft, suffix)
}

export function useComposerDraft(workspaceId: string | null | undefined, contextKey: string) {
  const suffix = draftSuffix(workspaceId, contextKey)
  const [draft, setDraft] = useState(() => ({ workspaceId, suffix, text: readDraft(suffix) }))
  // Another context: read its draft during render (no frame shows the old text), or carry ours over.
  if (draft.suffix !== suffix) {
    const text = arrivingDraft(readDraft(suffix), draft.text, draft.workspaceId === workspaceId)
    if (text !== readDraft(suffix)) {
      writeDraft(suffix, text)
      writeDraft(draft.suffix, '')
    }
    setDraft({ workspaceId, suffix, text })
  }

  const setText = useCallback((text: string) => {
    setDraft({ workspaceId, suffix, text })
    writeDraft(suffix, text)
  }, [workspaceId, suffix])

  return [draft.suffix === suffix ? draft.text : readDraft(suffix), setText] as const
}
