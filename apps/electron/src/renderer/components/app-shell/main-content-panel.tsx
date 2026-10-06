/**
 * MainContentPanel - the page for the open view
 *
 * Renders content based on the unified NavigationState. Sub-navigation is an index
 * page before the detail, never a sidebar list:
 * - Chats: the Chats index, or the ChatPage of the open chat
 * - Settings: the Settings index, or the settings page
 * - Sources and Skills (reached from the Settings index): the item's page
 * - Tasks, Projects and Library: the index page, or the task, project or item page
 * - Routines (automations): not built yet, only `SectionEmpty`
 *
 * The NavigationState is the single source of truth for what to display.
 */

import { useTranslation } from 'react-i18next'
import { Clock } from 'lucide-react'
import { Panel } from './panel'
import { PageHeader } from './page-header'
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
} from '@/contexts/navigation-context'
import { SourceInfoPage, ChatPage, TasksPage, TaskPage, ProjectsPage, ProjectPage, LibraryPage, LibraryItemPage } from '@/pages'
import ChatsIndexPage from '@/pages/chats-index-page'
import SkillInfoPage from '@/pages/skill-info-page'
import SettingsIndexPage from '@/pages/settings/settings-index-page'
import { getSettingsPageComponent } from '@/pages/settings/settings-pages'

/** A section with nothing open: the section's title in the header, a quiet line in the card. */
function EmptyPanel({ title, message }: { title: string; message: string }) {
  return (
    <div className="flex h-full flex-col">
      <PageHeader title={title} />
      <div className="flex flex-1 items-center justify-center text-muted-foreground">
        <p className="text-sm">{message}</p>
      </div>
    </div>
  )
}

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

  // Settings: the index (the bare `settings` route), or one settings page.
  if (isSettingsNavigation(navState)) {
    if (navState.subpage === null) return panel(<SettingsIndexPage />)
    const SettingsPageComponent = getSettingsPageComponent(navState.subpage)
    return panel(<SettingsPageComponent />)
  }

  if (isSourcesNavigation(navState)) {
    if (navState.details) {
      return panel(<SourceInfoPage sourceSlug={navState.details.sourceSlug} workspaceId={activeWorkspaceId || ''} />)
    }
    return panel(<EmptyPanel title={t('sidebar.sources')} message={t('sourcesList.noSourcesConfigured')} />)
  }

  if (isSkillsNavigation(navState)) {
    if (navState.details?.type === 'skill') {
      return panel(
        <SkillInfoPage
          skillSlug={navState.details.skillSlug}
          workspaceId={activeWorkspaceId || ''}
          workingDirectory={activeSessionWorkingDirectory}
        />,
      )
    }
    return panel(<EmptyPanel title={t('sidebar.skills')} message={t('skillsList.noSkillsConfigured')} />)
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
