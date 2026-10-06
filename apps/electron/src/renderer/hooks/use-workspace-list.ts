/**
 * Loads a workspace list into its atom: when the workspace is known or changes, and again on window focus
 * (no backend change broadcast exists yet). `refresh` is also what a hook calls after its own mutations.
 * `load` must be a stable function (a module-level one).
 */

import { useCallback, useEffect } from 'react'
import { useAtom, type PrimitiveAtom } from 'jotai'
import { useAppShellContext } from '@/context/app-shell-context'
import { listFor, type WorkspaceList } from '@/atoms/workspace-list'

export function useWorkspaceList<T>(listAtom: PrimitiveAtom<WorkspaceList<T>>, load: () => Promise<T[]>) {
  const { activeWorkspaceId } = useAppShellContext()
  const [state, setState] = useAtom(listAtom)

  const refresh = useCallback(async () => {
    if (!activeWorkspaceId) return
    try {
      setState({ workspaceId: activeWorkspaceId, items: await load(), loaded: true })
    } catch (error) {
      console.error('[useWorkspaceList] load failed:', error)
    }
  }, [activeWorkspaceId, load, setState])

  useEffect(() => {
    void refresh()
    window.addEventListener('focus', refresh)
    return () => window.removeEventListener('focus', refresh)
  }, [refresh])

  return { ...listFor(state, activeWorkspaceId), refresh }
}
