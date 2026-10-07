/**
 * The new chat's agent: an empty chat talks to the agent it was created with (the last pick of the workspace, else
 * its default). The chat's agent cannot change after it exists, so picking another one makes an empty chat with
 * that agent (same status, label, project, mode and folder) and opens it; leaving the empty one deletes it (the
 * navigation context's empty-chat cleanup, the one path for that).
 */

import * as React from 'react'
import { useTranslation } from 'react-i18next'
import { toast } from '@workspace/ui/components/sonner'
import { useAppShellContext } from '@/context/app-shell-context'
import { isSessionsNavigation, useNavigationState } from '@/contexts/navigation-context'
import { agentOf, useLoadedAgents } from '@/hooks/use-agents'
import { navigate, routes } from '@/lib/navigate'
import { setNewChatAgentId } from '@/lib/new-chat-agent'
import { buildRouteFromNavigationState } from '../../../shared/route-parser'
import type { Agent, Session } from '../../../shared/types'

export function useNewChatAgent(session: Session | null) {
  const { t } = useTranslation()
  const { activeWorkspaceId, onCreateSession } = useAppShellContext()
  const navState = useNavigationState()
  const agents = useLoadedAgents()
  const agent = agentOf(agents, session?.agentId)

  const pick = React.useCallback(async (next: Agent) => {
    if (!activeWorkspaceId || !session) return
    setNewChatAgentId(activeWorkspaceId, next.id)
    if (next.id === agent?.id) return
    try {
      const created = await onCreateSession(activeWorkspaceId, {
        agentId: next.id,
        sessionStatus: session.sessionStatus,
        labels: session.labels,
        projectId: session.projectId,
        permissionMode: session.permissionMode,
        workingDirectory: session.workingDirectory,
      })
      navigate(isSessionsNavigation(navState)
        ? (buildRouteFromNavigationState({ ...navState, details: { type: 'session', sessionId: created.id } }) as never)
        : routes.view.allSessions(created.id))
    } catch (error) {
      console.error('[AgentPicker] change failed:', error)
      toast.error(t('composer.error.changeAgent'))
    }
  }, [activeWorkspaceId, session, agent?.id, onCreateSession, navState, t])

  return { agents, agent, pick }
}
