/**
 * The activity of a task or project (`entity` is `task:<id>` or `project:<id>`): its comments and events in one
 * list, oldest first, read a page at a time (the newest `PAGE` first; `loadEarlier` adds the page before). Reloads
 * when the server says the comments changed (a comment, or a task change that wrote an event), keeping as many
 * items as were shown. The mutations return a `MutationResult` like the other domain hooks; only the author may
 * edit or delete a comment (`forbidden`), `updateComment` may carry the `updatedAt` last seen (`conflict`).
 */

import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { toast } from '@workspace/ui/components/sonner'
import { useAppShellContext } from '@/context/app-shell-context'
import type { Comment } from '../../shared/types'
import { useLiveData } from './use-live-data'

export const ACTIVITY_PAGE = 50
/** The most a reload asks for (the server's cap). */
const MAX_PAGE = 500
const NONE: Comment[] = []

interface State {
  key: string | null
  items: Comment[]
  more: boolean
}

export function useActivity(entity: string) {
  const { t } = useTranslation()
  const { activeWorkspaceId } = useAppShellContext()
  // Remembers what it was loaded for, so another entity or workspace never shows the old rows.
  const key = activeWorkspaceId ? `${activeWorkspaceId}/${entity}` : null
  const [state, setState] = useState<State>({ key: null, items: NONE, more: false })
  const latest = useRef(state)
  latest.current = state
  const [loadingEarlier, setLoadingEarlier] = useState(false)

  const fail = useCallback((error: unknown) => {
    console.error('[useActivity] load failed:', error)
    toast.error(t('common.loadFailed'), { id: 'load-failed' })
  }, [t])

  /** The newest page again, as long as what is shown (a reload keeps the earlier pages the person opened). */
  const refresh = useCallback(async () => {
    if (!key) return
    const shown = latest.current.key === key ? latest.current.items.length : 0
    try {
      const page = await window.electronAPI.getComments(entity, { limit: Math.min(MAX_PAGE, Math.max(ACTIVITY_PAGE, shown)) })
      setState({ key, items: page.items, more: page.more })
    } catch (error) {
      fail(error)
      setState((prev) => (prev.key === key ? prev : { key, items: NONE, more: false })) // settle: loaded, with what it had
    }
  }, [key, entity, fail])

  const loadEarlier = useCallback(async () => {
    const current = latest.current
    const first = current.items.find((item) => !item.id.startsWith('created-'))
    if (!key || current.key !== key || !current.more || !first) return
    setLoadingEarlier(true)
    try {
      const page = await window.electronAPI.getComments(entity, { before: first.id, limit: ACTIVITY_PAGE })
      setState((prev) => (prev.key === key ? { key, items: [...page.items, ...prev.items], more: page.more } : prev))
    } catch (error) {
      fail(error)
    } finally {
      setLoadingEarlier(false)
    }
  }, [key, entity, fail])

  useEffect(() => {
    void refresh()
  }, [refresh])

  const mutate = useLiveData('comments', activeWorkspaceId, refresh)

  const actions = useMemo(() => {
    const api = window.electronAPI
    return {
      createComment: (content: string) => mutate(() => api.createComment(entity, content)),
      updateComment: (id: string, content: string, expectedUpdatedAt?: number) => mutate(() => api.updateComment(id, content, expectedUpdatedAt)),
      deleteComment: (id: string) => mutate(() => api.deleteComment(id)),
    }
  }, [mutate, entity])

  const current = state.key === key
  return {
    items: current ? state.items : NONE,
    more: current && state.more,
    loaded: current && key !== null,
    loadingEarlier,
    loadEarlier,
    refresh,
    ...actions,
  }
}
