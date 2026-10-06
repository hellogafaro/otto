/** The workspace's projects, active and archived (`useProjects` loads it; pages filter by status). */

import type { Project } from '../../shared/types'
import { workspaceListAtom } from './workspace-list'

export const projectsAtom = workspaceListAtom<Project>()
