/**
 * The workspace's projects (active and archived; deleted ones are never listed) and their mutations.
 * Every mutation returns a `MutationResult` (a page turns `{ ok: false, code }` into a toast) and then
 * reloads the list, also on `conflict` so the page shows what changed. Updates carry `expectedUpdatedAt`.
 * `members` are on the project (actors); add and remove return the updated project.
 */

import { useMemo } from 'react'
import { projectsAtom } from '@/atoms/projects'
import type { Project, ProjectStatus, ProjectUpdate, Resource } from '../../shared/types'
import { useWorkspaceList } from './use-workspace-list'

const loadProjects = () => window.electronAPI.getProjects({ status: ['active', 'archived'] })

export function useProjects() {
  const { items: projects, loaded, refresh, mutate } = useWorkspaceList(projectsAtom, loadProjects, 'projects')

  const actions = useMemo(() => {
    const api = window.electronAPI
    return {
      createProject: (input: { title: string; description?: string; resources?: Resource[] }) => mutate(() => api.createProject(input)),
      updateProject: (id: string, patch: ProjectUpdate) => mutate(() => api.updateProject(id, patch)),
      /** `archived` hides it from the default list, `deleted` removes it (restoring is `active`). */
      setProjectStatus: (id: string, status: ProjectStatus) => mutate(() => api.setProjectStatus(id, status)),
      addProjectMember: (id: string, actor: string) => mutate(() => api.addProjectMember(id, actor)),
      removeProjectMember: (id: string, actor: string) => mutate(() => api.removeProjectMember(id, actor)),
    }
  }, [mutate])

  return { projects: projects as Project[], loaded, refresh, ...actions }
}
