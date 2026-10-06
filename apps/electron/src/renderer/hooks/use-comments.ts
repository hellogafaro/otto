/**
 * The comments on a task or project (`entity` is `task:<id>` or `project:<id>`), oldest first. Reloads when the
 * server says the comments changed. The mutations return a `MutationResult` like the other domain hooks; only the
 * author may edit or delete (`forbidden`), `updateComment` may carry the `updatedAt` last seen (`conflict`).
 */

import { useCallback, useEffect, useMemo, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { toast } from '@workspace/ui/components/sonner'
import { useAppShellContext } from '@/context/app-shell-context'
import type { Comment } from '../../shared/types'
import { useLiveData } from './use-live-data'

const NONE: Comment[] = []

export function useComments(entity: string) {
  const { t } = useTranslation()
  const { activeWorkspaceId } = useAppShellContext()
  // Remembers what it was loaded for, so another entity or workspace never shows the old rows.
  const key = activeWorkspaceId ? `${activeWorkspaceId}/${entity}` : null
  const [state, setState] = useState<{ key: string | null; items: Comment[] }>({ key: null, items: NONE })

  const refresh = useCallback(async () => {
    if (!key) return
    try {
      setState({ key, items: await window.electronAPI.getComments(entity) })
    } catch (error) {
      console.error('[useComments] load failed:', error)
      setState((prev) => ({ key, items: prev.key === key ? prev.items : NONE })) // settle: loaded, with what it had
      toast.error(t('common.loadFailed'), { id: 'load-failed' })
    }
  }, [key, entity, t])

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
  return { comments: current ? state.items : NONE, loaded: current && key !== null, refresh, ...actions }
}
