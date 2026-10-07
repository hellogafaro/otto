/**
 * The workspace's agents (the default, the oldest, first) and their mutations. Same contract as `useTasks`: results,
 * not throws, and a reload after each mutation and on `domain:changed` `agents`.
 */

import { useMemo } from 'react'
import { useAtomValue } from 'jotai'
import { agentsAtom } from '@/atoms/agents'
import { listFor } from '@/atoms/workspace-list'
import { useAppShellContext } from '@/context/app-shell-context'
import type { Agent, AgentUpdate } from '../../shared/types'
import { useWorkspaceList } from './use-workspace-list'

const loadAgents = () => window.electronAPI.getAgents()

export function useAgents() {
  const { items: agents, loaded, refresh, mutate } = useWorkspaceList(agentsAtom, loadAgents, 'agents')

  const actions = useMemo(() => {
    const api = window.electronAPI
    return {
      createAgent: (input: Parameters<typeof api.createAgent>[0]) => mutate(() => api.createAgent(input)),
      updateAgent: (id: string, patch: AgentUpdate) => mutate(() => api.updateAgent(id, patch)),
      deleteAgent: (id: string) => mutate(() => api.deleteAgent(id)),
    }
  }, [mutate])

  return { agents: agents as Agent[], loaded, refresh, ...actions }
}

/** The workspace's agents as already loaded, the default first; never fetches (the shell composer's `useAgents` loads them). */
export function useLoadedAgents(): Agent[] {
  const { activeWorkspaceId } = useAppShellContext()
  return listFor(useAtomValue(agentsAtom), activeWorkspaceId).items
}

/** The agent with this id, else (none, or deleted) the default agent, the first; undefined until they have loaded. */
export const agentOf = (agents: Agent[], agentId?: string | null): Agent | undefined => agents.find((agent) => agent.id === agentId) ?? agents[0]
