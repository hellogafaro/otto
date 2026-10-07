/**
 * The new chat's "With": an empty chat talks to the agent it was created with (the last pick of the workspace, else
 * its default). The chat's agent cannot change after it exists, so picking another one makes an empty chat with
 * that agent (same status, label, project, mode and folder) and opens it; leaving the empty one deletes it (the
 * navigation context's empty-chat cleanup, the one path for that). Picking a person (never the viewer) opens your
 * direct message with them when there is one (`dmKey`), else keeps them picked: the first send creates the DM
 * (`dmWith`) and sends there.
 */

import * as React from 'react'
import { useTranslation } from 'react-i18next'
import { useStore } from 'jotai'
import { userIdOf } from '@otto/shared/actors'
import { toast } from '@workspace/ui/components/sonner'
import { sessionMetaMapAtom } from '@/atoms/sessions'
import { useAppShellContext } from '@/context/app-shell-context'
import { isSessionsNavigation, useNavigationState } from '@/contexts/navigation-context'
import { agentOf, useLoadedAgents } from '@/hooks/use-agents'
import { useWorkspaceMembers } from '@/hooks/use-workspace-members'
import { navigate, routes } from '@/lib/navigate'
import { setNewChatAgentId } from '@/lib/new-chat-agent'
import { buildRouteFromNavigationState } from '../../../shared/route-parser'
import type { Agent, FileAttachment, Session } from '../../../shared/types'

export function useNewChatAgent(session: Session | null) {
  const { t } = useTranslation()
  const { activeWorkspaceId, onCreateSession, onSendMessage } = useAppShellContext()
  const navState = useNavigationState()
  const store = useStore()
  const agents = useLoadedAgents()
  const agent = agentOf(agents, session?.agentId)
  const { members, me } = useWorkspaceMembers()
  const people = React.useMemo(() => members.filter((member) => member.actor.startsWith('user:') && member.actor !== me), [members, me])
  // The person picked for this empty chat ('user:<id>'), until the first send makes the DM.
  const [person, setPerson] = React.useState<string | null>(null)
  React.useEffect(() => setPerson(null), [session?.id])

  const open = React.useCallback((sessionId: string) => {
    navigate(isSessionsNavigation(navState)
      ? (buildRouteFromNavigationState({ ...navState, details: { type: 'session', sessionId } }) as never)
      : routes.view.allSessions(sessionId))
  }, [navState])

  const pick = React.useCallback(async (next: Agent) => {
    if (!activeWorkspaceId || !session) return
    setPerson(null)
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
      open(created.id)
    } catch (error) {
      console.error('[AgentPicker] change failed:', error)
      toast.error(t('composer.error.changeAgent'))
    }
  }, [activeWorkspaceId, session, agent?.id, onCreateSession, open, t])

  const pickPerson = React.useCallback((actor: string) => {
    const dm = [...store.get(sessionMetaMapAtom).values()].find((meta) => meta.dmKey?.split('|').includes(actor))
    if (dm) open(dm.id)
    else setPerson(actor)
  }, [store, open])

  /** The first send to the picked person: creates the DM (or gets the existing one), sends there and opens it. */
  const sendToPerson = React.useCallback(async (text: string, attachments?: FileAttachment[], skillSlugs?: string[]) => {
    const userId = userIdOf(person)
    if (!activeWorkspaceId || !userId) return
    try {
      const created = await onCreateSession(activeWorkspaceId, { dmWith: userId })
      onSendMessage(created.id, text, attachments, skillSlugs)
      open(created.id)
    } catch (error) {
      console.error('[AgentPicker] DM failed:', error)
      toast.error(t('composer.error.startChat'))
    }
  }, [activeWorkspaceId, person, onCreateSession, onSendMessage, open, t])

  return { agents, agent, pick, people, person, pickPerson, sendToPerson }
}
