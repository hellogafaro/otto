/**
 * Loads a workspace list into its atom: when the workspace is known or changes, when the server says its
 * `domain` changed (`useLiveData`), and again on window focus (in case a push was missed). `mutate` runs a
 * mutation as a `MutationResult` and reloads after it; `refresh` reloads.
 * `load` must be a stable function (a module-level one); it gets the workspace id. A failed load settles the
 * list (`loaded`, the rows it had) so pages leave their skeletons, and toasts "Couldn't load" (one at a time).
 */

import { useCallback, useEffect } from 'react'
import { useAtom, type PrimitiveAtom } from 'jotai'
import { useTranslation } from 'react-i18next'
import { toast } from '@workspace/ui/components/sonner'
import { useAppShellContext } from '@/context/app-shell-context'
import { failedList, listFor, type WorkspaceList } from '@/atoms/workspace-list'
import type { DomainChange } from '../../shared/types'
import { useLiveData } from './use-live-data'

export function useWorkspaceList<T>(
  listAtom: PrimitiveAtom<WorkspaceList<T>>,
  load: (workspaceId: string) => Promise<T[]>,
  domain: DomainChange['domain'],
) {
  const { t } = useTranslation()
  const { activeWorkspaceId } = useAppShellContext()
  const [state, setState] = useAtom(listAtom)

  const refresh = useCallback(async () => {
    if (!activeWorkspaceId) return
    try {
      setState({ workspaceId: activeWorkspaceId, items: await load(activeWorkspaceId), loaded: true })
    } catch (error) {
      console.error('[useWorkspaceList] load failed:', error)
      setState((prev) => failedList(prev, activeWorkspaceId))
      toast.error(t('common.loadFailed'), { id: 'load-failed' })
    }
  }, [activeWorkspaceId, load, setState, t])

  useEffect(() => {
    void refresh()
    window.addEventListener('focus', refresh)
    return () => window.removeEventListener('focus', refresh)
  }, [refresh])

  const mutate = useLiveData(domain, activeWorkspaceId, refresh)

  return { ...listFor(state, activeWorkspaceId), refresh, mutate }
}
