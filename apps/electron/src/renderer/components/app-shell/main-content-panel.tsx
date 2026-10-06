/**
 * MainContentPanel - the page for the open view
 *
 * Renders content based on the unified NavigationState. Sub-navigation is an index
 * page before the detail, except in Settings, whose pages are listed by its own sidebar:
 * - Chats: the Chats index, or the ChatPage of the open chat
 * - Settings: one settings page (no index: Settings opens on General)
 * - Skills and Sources (in the settings sidebar): the grid, or the item's page
 * - Tasks, Projects and Library: the index page, or the task, project or item page
 * - Inbox: your notifications
 * - Routines (automations): not built yet, only `SectionEmpty`
 *
 * The NavigationState is the single source of truth for what to display.
 */

import { useTranslation } from 'react-i18next'
import { Clock } from 'lucide-react'
import { Panel } from './panel'
import { SectionEmpty } from './section-empty'
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
import { SourceInfoPage, ChatPage, TasksPage, TaskPage, ProjectsPage, ProjectPage, LibraryPage, LibraryItemPage } from '@/pages'
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
  const { t } = useTranslation()
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

  // Tasks, Projects and Library: the index, or the open task, project or item.
  if (isTasksNavigation(navState)) {
    return panel(navState.details ? <TaskPage taskId={navState.details.taskId} /> : <TasksPage />)
  }
  if (isProjectsNavigation(navState)) {
    return panel(navState.details ? <ProjectPage projectId={navState.details.projectId} /> : <ProjectsPage />)
  }
  if (isLibraryNavigation(navState)) {
    return panel(navState.details ? <LibraryItemPage itemId={navState.details.itemId} /> : <LibraryPage />)
  }

  if (isInboxNavigation(navState)) return panel(<InboxPage />)

  // Routines (automations) are not built yet: only their empty state and its New button.
  if (isAutomationsNavigation(navState)) {
    return panel(
      <SectionEmpty
        icon={Clock}
        title={t('sectionEmpty.routinesTitle')}
        description={t('sectionEmpty.routinesDescription')}
        cta={t('sectionEmpty.newRoutine')}
      />,
    )
  }

  // Chats: the index, or the open chat.
  if (isSessionsNavigation(navState) && navState.details) {
    return panel(<ChatPage sessionId={navState.details.sessionId} />)
  }
  return panel(<ChatsIndexPage />)
}
