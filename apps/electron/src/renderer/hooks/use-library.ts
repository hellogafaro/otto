/**
 * Every library item of the workspace, folders included (the page filters by tab, folder and creator, and
 * derives folder paths), and its mutations: same contract as `useProjects`. A document or file's content is
 * read with `window.electronAPI.readLibraryItem(id)`; replacing it needs `expectedUpdatedAt` (`conflict`).
 * `deleteLibraryItem` of a folder that is not empty is `not_empty`; content over the cap is `too_large`.
 */

import { useMemo } from 'react'
import { libraryAtom } from '@/atoms/library'
import { toResult } from '@/lib/domain-result'
import type { LibraryContent, LibraryItem, LibraryUpdate } from '../../shared/types'
import { useWorkspaceList } from './use-workspace-list'

const loadLibrary = () => window.electronAPI.getLibraryItems()

export function useLibrary() {
  const { items, loaded, refresh } = useWorkspaceList(libraryAtom, loadLibrary)

  const actions = useMemo(() => {
    const api = window.electronAPI
    const mutate = <T,>(call: () => Promise<T>) => toResult(call).finally(refresh)
    return {
      createLibraryItem: (input: { title: string; mime: string; content: LibraryContent; folderId?: string | null }) =>
        mutate(() => api.createLibraryItem(input)),
      createLibraryFolder: (input: { title: string; folderId?: string | null }) => mutate(() => api.createLibraryFolder(input)),
      /** Rename, move (`folderId`) or replace the content. */
      updateLibraryItem: (id: string, patch: LibraryUpdate) => mutate(() => api.updateLibraryItem(id, patch)),
      deleteLibraryItem: (id: string) => mutate(() => api.deleteLibraryItem(id)),
    }
  }, [refresh])

  return { items: items as LibraryItem[], loaded, refresh, ...actions }
}
