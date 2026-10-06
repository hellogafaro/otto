/**
 * MainContentPanel - the page for the open view
 *
 * Renders content based on the unified NavigationState. Sub-navigation is an index
 * page before the detail, except in Settings, whose pages are listed by its own sidebar:
 * - Chats: the Chats index, or the ChatPage of the open chat
 * - Settings: one settings page (no index: Settings opens on General)
 * - Skills and Sources (in the settings sidebar): the grid, or the item's page
 * - Tasks, Projects, Routines and Library: the index page, or the task, project, routine or item page
 * - Inbox: your notifications
 *
 * The NavigationState is the single source of truth for what to display.
 */

import { Panel } from './panel'
import { useAppShellContext } from '@/context/app-shell-context'
import {
  useNavigationState,
  isSessionsNavigation,
  isSourcesNavigation,
  isSettingsNavigation,
  isSkillsNavigation,
  isAutomationsNavigation,
  isProjectsNavigation,
  isLibraryNavigation,
  isTasksNavigation,
  isInboxNavigation,
} from '@/contexts/navigation-context'
import { SourceInfoPage, ChatPage, TasksPage, TaskPage, ProjectsPage, ProjectPage, RoutinesPage, RoutinePage, LibraryPage, LibraryItemPage } from '@/pages'
import ChatsIndexPage from '@/pages/chats-index-page'
import { InboxPage } from '@/pages/inbox/inbox-page'
import SkillInfoPage from '@/pages/skill-info-page'
import { SkillsPage } from '@/pages/skills-page'
import { SourcesPage } from '@/pages/sources-page'
import { getSettingsPageComponent } from '@/pages/settings/settings-pages'

export interface MainContentPanelProps {
  /** Optional className for the container */
  className?: string
}

export function MainContentPanel({ className }: MainContentPanelProps) {
  const navState = useNavigationState()
  const { activeWorkspaceId, activeSessionWorkingDirectory } = useAppShellContext()

  const panel = (content: React.ReactNode) => (
    <Panel variant="grow" className={className}>
      {content}
    </Panel>
  )

  if (isSettingsNavigation(navState)) {
    const SettingsPageComponent = getSettingsPageComponent(navState.subpage)
    return panel(<SettingsPageComponent />)
  }

  if (isSourcesNavigation(navState)) {
    return panel(navState.details
      ? <SourceInfoPage sourceSlug={navState.details.sourceSlug} workspaceId={activeWorkspaceId || ''} />
      : <SourcesPage />)
  }

  if (isSkillsNavigation(navState)) {
    return panel(navState.details
      ? <SkillInfoPage skillSlug={navState.details.skillSlug} workspaceId={activeWorkspaceId || ''} workingDirectory={activeSessionWorkingDirectory} />
      : <SkillsPage />)
  }

  // Tasks, Projects, Routines and Library: the index, or the open task, project, routine or item.
  if (isTasksNavigation(navState)) {
    return panel(navState.details ? <TaskPage taskId={navState.details.taskId} /> : <TasksPage />)
  }
  if (isProjectsNavigation(navState)) {
    return panel(navState.details ? <ProjectPage projectId={navState.details.projectId} /> : <ProjectsPage />)
  }
  if (isAutomationsNavigation(navState)) {
    return panel(navState.details ? <RoutinePage routineId={navState.details.automationId} /> : <RoutinesPage />)
  }
  if (isLibraryNavigation(navState)) {
    return panel(navState.details ? <LibraryItemPage itemId={navState.details.itemId} /> : <LibraryPage />)
  }

  if (isInboxNavigation(navState)) return panel(<InboxPage />)

  // Chats: the index, or the open chat.
  if (isSessionsNavigation(navState) && navState.details) {
    return panel(<ChatPage sessionId={navState.details.sessionId} />)
  }
  return panel(<ChatsIndexPage />)
}
