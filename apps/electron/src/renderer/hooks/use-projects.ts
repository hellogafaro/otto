/**
 * The workspace's projects (active and archived; deleted ones are never listed) and their mutations.
 * Every mutation returns a `MutationResult` (a page turns `{ ok: false, code }` into a toast) and then
 * reloads the list, also on `conflict` so the page shows what changed. Updates carry `expectedUpdatedAt`.
 * Members are read with `window.electronAPI.getProjectMembers(id)` by the page that shows them.
 */

import { useMemo } from 'react'
import { projectsAtom } from '@/atoms/projects'
import { toResult } from '@/lib/domain-result'
import type { MemberRole, Project, ProjectStatus, ProjectUpdate, Resource } from '../../shared/types'
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
      setProjectMember: (id: string, actor: string, role: MemberRole) => toResult(() => api.setProjectMember(id, actor, role)),
      removeProjectMember: (id: string, actor: string) => toResult(() => api.removeProjectMember(id, actor)),
    }
  }, [mutate])

  return { projects: projects as Project[], loaded, refresh, ...actions }
}
