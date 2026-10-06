import type { RpcServer } from '@otto/server-core/transport'
import type { HandlerDeps } from '../handler-deps'

import { registerAgentsHandlers } from './agents'
import { registerAuthHandlers } from './auth'
import { registerAutomationsHandlers } from './automations'
import { registerCommentsHandlers } from './comments'
import { registerDecisionsHandlers } from './decisions'
import { registerFilesHandlers } from './files'
import { registerLabelsHandlers } from './labels'
import { registerLibraryHandlers } from './library'
import { registerLlmConnectionsHandlers } from './llm-connections'
import { registerOAuthHandlers } from './oauth'
import { registerResourcesHandlers } from './resources'
import { registerOnboardingHandlers } from './onboarding'
import { registerSessionsHandlers } from './sessions'
export { registerSessionsHandlers, cleanupSessionFileWatchForClient } from './sessions'
import { registerServerHandlers } from './server'
import type { ServerHandlerContext } from '../../bootstrap/headless-start'
export type { ServerHandlerContext } from '../../bootstrap/headless-start'
export { getHealthCheck } from './server'
import { registerSettingsHandlers } from './settings'
import { registerProjectsHandlers } from './projects'
import { registerNotificationsHandlers } from './notifications'
import { registerTasksHandlers } from './tasks'
import { broadcastDomainChanges } from './domain-changes'
import { registerSkillsHandlers } from './skills'
import { registerSourcesHandlers } from './sources'
import { registerStatusesHandlers } from './statuses'
import { registerSystemCoreHandlers } from './system'
import { registerTranscriptionHandlers } from './transcription'
import { registerTransferHandlers } from './transfer'
import { registerWorkspaceCoreHandlers } from './workspace'
import { registerWorkspaceMembersHandlers } from './workspaces-members'
import { registerMessagingHandlers } from './messaging'
import { guardSessionChannels } from './session-guard'

export function registerCoreRpcHandlers(
  server: RpcServer,
  deps: HandlerDeps,
  serverCtx?: ServerHandlerContext,
): void {
  // Chats are private: a handler that takes a session id runs only for the chat's owner.
  server = guardSessionChannels(server, deps)
  // Every write of library, projects, tasks, comments, notifications and members pushes `domain:changed` once it succeeds.
  server = broadcastDomainChanges(server, deps)
  registerAgentsHandlers(server, deps)
  registerAuthHandlers(server, deps)
  registerAutomationsHandlers(server, deps)
  registerDecisionsHandlers(server, deps)
  registerFilesHandlers(server, deps)
  registerLabelsHandlers(server, deps)
  registerLibraryHandlers(server, deps)
  registerLlmConnectionsHandlers(server, deps)
  registerOAuthHandlers(server, deps)
  registerOnboardingHandlers(server, deps)
  registerResourcesHandlers(server, deps)
  registerSessionsHandlers(server, deps)
  if (serverCtx) registerServerHandlers(server, deps, serverCtx)
  registerSettingsHandlers(server, deps)
  registerProjectsHandlers(server, deps)
  registerTasksHandlers(server, deps)
  registerCommentsHandlers(server, deps)
  registerNotificationsHandlers(server, deps)
  registerSkillsHandlers(server, deps)
  registerSourcesHandlers(server, deps)
  registerStatusesHandlers(server, deps)
  registerSystemCoreHandlers(server, deps)
  registerTranscriptionHandlers(server, deps)
  registerTransferHandlers(server)
  registerWorkspaceCoreHandlers(server, deps)
  registerWorkspaceMembersHandlers(server)
  registerMessagingHandlers(server, deps)
}
