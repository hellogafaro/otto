/** The workspace's tasks of every status except deleted (`useTasks` loads it; pages filter). */

import type { Task } from '../../shared/types'
import { workspaceListAtom } from './workspace-list'

export const tasksAtom = workspaceListAtom<Task>()
