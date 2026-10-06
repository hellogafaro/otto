/** The workspace's agents, the default (oldest) first (`useAgents` loads it). */

import type { Agent } from '../../shared/types'
import { workspaceListAtom } from './workspace-list'

export const agentsAtom = workspaceListAtom<Agent>()
