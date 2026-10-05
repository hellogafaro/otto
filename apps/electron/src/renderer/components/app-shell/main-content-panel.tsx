/**
 * MainContentPanel - Right panel component for displaying content
 *
 * Renders content based on the unified NavigationState:
 * - Chats navigator: ChatPage for selected session, or empty state
 * - Sources navigator: SourceInfoPage for selected source, or empty state
 * - Settings navigator: Settings, Preferences, or Shortcuts page
 * - Projects, Schedules, Documents: not built yet, only `SectionEmpty`
 *
 * The NavigationState is the single source of truth for what to display.
 *
 * When multiple sessions are selected (multi-select mode), shows the
 * MultiSelectPanel with batch action buttons instead of a single chat.
 */

import * as React from 'react'
import { useCallback, useMemo, useState } from 'react'
import { useAtomValue } from 'jotai'
import { useTranslation } from 'react-i18next'
import { Clock, FileText, Folder } from 'lucide-react'
import { Panel } from './panel'
import { PageHeader } from './page-header'
import { MultiSelectPanel } from './multi-select-panel'
import { SectionEmpty } from './section-empty'
import { useAppShellContext } from '@/context/app-shell-context'
import { sessionMetaMapAtom, type SessionMeta } from '@/atoms/sessions'
import {
  useNavigationState,
  isSessionsNavigation,
  isSourcesNavigation,
  isSettingsNavigation,
  isSkillsNavigation,
  isAutomationsNavigation,
  isProjectsNavigation,
  isPagesNavigation,
} from '@/contexts/navigation-context'
import { useSessionSelection, useIsMultiSelectActive, useSelectedIds, useSelectionCount } from '@/hooks/use-session'
import { sourceSelection, skillSelection } from '@/hooks/use-entity-selection'
import { extractLabelId } from '@otto/shared/labels'
import type { SessionStatusId } from '@/config/session-status-config'
import { SourceInfoPage, ChatPage } from '@/pages'
import SkillInfoPage from '@/pages/skill-info-page'
import { getSettingsPageComponent } from '@/pages/settings/settings-pages'
import { SendResourceToWorkspaceDialog, type SendResourceType } from './send-resource-to-workspace-dialog'

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
  /**
   * Override the navigation state for this panel.
   * When provided, this panel renders based on the override instead of the global NavigationState.
   * Used by PanelSlot to render panels in the panel stack.
   */
  navStateOverride?: import('../../../shared/types').NavigationState | null
}

export function MainContentPanel({
  className,
  navStateOverride,
}: MainContentPanelProps) {
  const { t } = useTranslation()
  const globalNavState = useNavigationState()
  const navState = navStateOverride ?? globalNavState
  const {
    activeWorkspaceId,
    workspaces,
    onSessionStatusChange,
    onArchiveSession,
    onSessionLabelsChange,
    sessionStatuses,
    labels,
    activeSessionWorkingDirectory,
  } = useAppShellContext()

  // Session multi-select state
  const isMultiSelectActive = useIsMultiSelectActive()
  const selectedIds = useSelectedIds()
  const selectionCount = useSelectionCount()
  const { clearMultiSelect } = useSessionSelection()
  const sessionMetaMap = useAtomValue(sessionMetaMapAtom)

  // Source multi-select state
  const isSourceMultiSelectActive = sourceSelection.useIsMultiSelectActive()
  const sourceSelectionCount = sourceSelection.useSelectionCount()
  const selectedSourceIds = sourceSelection.useSelectedIds()
  const { clearMultiSelect: clearSourceSelection } = sourceSelection.useSelection()

  // Skill multi-select state
  const isSkillMultiSelectActive = skillSelection.useIsMultiSelectActive()
  const skillSelectionCount = skillSelection.useSelectionCount()
  const selectedSkillIds = skillSelection.useSelectedIds()
  const { clearMultiSelect: clearSkillSelection } = skillSelection.useSelection()

  // Send to Workspace dialog state (shared across resource types)
  const [sendDialogOpen, setSendDialogOpen] = useState(false)
  const [sendResourceType, setSendResourceType] = useState<SendResourceType>('source')
  const [sendResourceIds, setSendResourceIds] = useState<string[]>([])
  const [sendResourceLabel, setSendResourceLabel] = useState('')
  const hasOtherWorkspaces = workspaces.length > 1

  const openSendDialog = useCallback((type: SendResourceType, ids: Set<string>) => {
    const count = ids.size
    setSendResourceType(type)
    setSendResourceIds([...ids])
    setSendResourceLabel(`${count} ${type}${count !== 1 ? 's' : ''}`)
    setSendDialogOpen(true)
  }, [])

  const selectedMetas = useMemo(() => {
    const metas: SessionMeta[] = []
    selectedIds.forEach((id) => {
      const meta = sessionMetaMap.get(id)
      if (meta) metas.push(meta)
    })
    return metas
  }, [selectedIds, sessionMetaMap])

  const activeStatusId = useMemo((): SessionStatusId | null => {
    if (selectedMetas.length === 0) return null
    const first = (selectedMetas[0].sessionStatus || 'todo') as SessionStatusId
    const allSame = selectedMetas.every(meta => (meta.sessionStatus || 'todo') === first)
    return allSame ? first : null
  }, [selectedMetas])

  const appliedLabelIds = useMemo(() => {
    if (selectedMetas.length === 0) return new Set<string>()
    const toLabelSet = (meta: SessionMeta) =>
      new Set((meta.labels || []).map(entry => extractLabelId(entry)))
    const [first, ...rest] = selectedMetas.map(toLabelSet)
    const intersection = new Set(first)
    for (const labelSet of rest) {
      for (const id of [...intersection]) {
        if (!labelSet.has(id)) intersection.delete(id)
      }
    }
    return intersection
  }, [selectedMetas])

  // Batch operations for multi-select
  const handleBatchSetStatus = useCallback((status: SessionStatusId) => {
    selectedIds.forEach(sessionId => {
      onSessionStatusChange(sessionId, status)
    })
  }, [selectedIds, onSessionStatusChange])

  const handleBatchArchive = useCallback(() => {
    selectedIds.forEach(sessionId => {
      onArchiveSession(sessionId)
    })
    clearMultiSelect()
  }, [selectedIds, onArchiveSession, clearMultiSelect])

  const handleBatchToggleLabel = useCallback((labelId: string) => {
    if (!onSessionLabelsChange) return
    const allHaveLabel = selectedMetas.every(meta =>
      (meta.labels || []).some(entry => extractLabelId(entry) === labelId)
    )

    selectedMetas.forEach(meta => {
      const labels = meta.labels || []
      const hasLabel = labels.some(entry => extractLabelId(entry) === labelId)
      const filtered = labels.filter(entry => extractLabelId(entry) !== labelId)
      const nextLabels = allHaveLabel
        ? filtered
        : (hasLabel ? labels : [...labels, labelId])
      onSessionLabelsChange(meta.id, nextLabels)
    })
  }, [selectedMetas, onSessionLabelsChange])

  // Renders the Send to Workspace dialog (portal-based, so it overlays regardless of position) beside the content.
  const withSendDialog = (content: React.ReactNode) => (
    <>
      {content}
      <SendResourceToWorkspaceDialog
        open={sendDialogOpen}
        onOpenChange={setSendDialogOpen}
        resourceType={sendResourceType}
        resourceIds={sendResourceIds}
        resourceLabel={sendResourceLabel}
        workspaces={workspaces}
        activeWorkspaceId={activeWorkspaceId || ''}
      />
    </>
  )

  // Settings navigator - uses component map from settings-pages.ts.
  // Bare `settings` route (subpage === null) means navigator-only view in compact mode;
  // PanelStackContainer hides the content panel entirely. On desktop the panel still
  // mounts, so fall back to the App page so it isn't empty.
  if (isSettingsNavigation(navState)) {
    const subpage = navState.subpage ?? 'app'
    const SettingsPageComponent = getSettingsPageComponent(subpage)
    return withSendDialog(
      <Panel variant="grow" className={className}>
        <SettingsPageComponent />
      </Panel>
    )
  }

  // Sources navigator - show source info, multi-select panel, or empty state
  if (isSourcesNavigation(navState)) {
    if (isSourceMultiSelectActive) {
      return withSendDialog(
        <Panel variant="grow" className={className}>
          <MultiSelectPanel
            count={sourceSelectionCount}
            entityType="source"
            onSendToWorkspace={hasOtherWorkspaces ? () => openSendDialog('source', selectedSourceIds) : undefined}
            onClearSelection={clearSourceSelection}
          />
        </Panel>
      )
    }
    if (navState.details) {
      return withSendDialog(
        <Panel variant="grow" className={className}>
          <SourceInfoPage
            sourceSlug={navState.details.sourceSlug}
            workspaceId={activeWorkspaceId || ''}
          />
        </Panel>
      )
    }
    // No source selected - empty state
    return withSendDialog(
      <Panel variant="grow" className={className}>
        <EmptyPanel title={t("sidebar.sources")} message={t("sourcesList.noSourcesConfigured")} />
      </Panel>
    )
  }

  // Skills navigator - show skill info, multi-select panel, or empty state
  if (isSkillsNavigation(navState)) {
    if (isSkillMultiSelectActive) {
      return withSendDialog(
        <Panel variant="grow" className={className}>
          <MultiSelectPanel
            count={skillSelectionCount}
            entityType="skill"
            onSendToWorkspace={hasOtherWorkspaces ? () => openSendDialog('skill', selectedSkillIds) : undefined}
            onClearSelection={clearSkillSelection}
          />
        </Panel>
      )
    }
    if (navState.details?.type === 'skill') {
      return withSendDialog(
        <Panel variant="grow" className={className}>
          <SkillInfoPage
            skillSlug={navState.details.skillSlug}
            workspaceId={activeWorkspaceId || ''}
            workingDirectory={activeSessionWorkingDirectory}
          />
        </Panel>
      )
    }
    // No skill selected - empty state
    return withSendDialog(
      <Panel variant="grow" className={className}>
        <EmptyPanel title={t("sidebar.skills")} message={t("skillsList.noSkillsConfigured")} />
      </Panel>
    )
  }

  // Not built yet: Projects, Schedules (automations) and Documents (pages) show only
  // their empty state and its New button, whatever the route's details.
  const unbuilt = isProjectsNavigation(navState)
    ? {
        icon: Folder,
        title: t("sectionEmpty.projectsTitle"),
        description: t("sectionEmpty.projectsDescription"),
        cta: t("sectionEmpty.newProject"),
      }
    : isAutomationsNavigation(navState)
      ? {
          icon: Clock,
          title: t("sectionEmpty.schedulesTitle"),
          description: t("sectionEmpty.schedulesDescription"),
          cta: t("sectionEmpty.newSchedule"),
        }
      : isPagesNavigation(navState)
        ? {
            icon: FileText,
            title: t("sectionEmpty.documentsTitle"),
            description: t("sectionEmpty.documentsDescription"),
            cta: t("sectionEmpty.newDocument"),
          }
        : null
  if (unbuilt) {
    return withSendDialog(
      <Panel variant="grow" className={className}>
        <SectionEmpty {...unbuilt} />
      </Panel>
    )
  }

  // Chats navigator - show chat, multi-select panel, or empty state
  if (isSessionsNavigation(navState)) {
    // Multi-select mode: show batch actions panel
    if (isMultiSelectActive) {
      return withSendDialog(
        <Panel variant="grow" className={className}>
          <MultiSelectPanel
            count={selectionCount}
            sessionStatuses={sessionStatuses}
            activeStatusId={activeStatusId}
            onSetStatus={handleBatchSetStatus}
            labels={labels}
            appliedLabelIds={appliedLabelIds}
            onToggleLabel={handleBatchToggleLabel}
            onArchive={handleBatchArchive}
            onClearSelection={clearMultiSelect}
          />
        </Panel>
      )
    }

    if (navState.details) {
      return withSendDialog(
        <Panel variant="grow" className={className}>
          <ChatPage sessionId={navState.details.sessionId} />
        </Panel>
      )
    }
    // No session selected - empty state
    return withSendDialog(
      <Panel variant="grow" className={className}>
        <EmptyPanel title={t("sidebar.chats")} message={t("session.noSessionSelected")} />
      </Panel>
    )
  }

  // Fallback (should not happen with proper NavigationState)
  return withSendDialog(
    <Panel variant="grow" className={className}>
      <EmptyPanel title={t("sidebar.chats")} message={t("session.selectConversation")} />
    </Panel>
  )
}
