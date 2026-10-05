/**
 * AppSidebar - the shell's one sidebar, on the frame beside the page card.
 *
 * Top to bottom: the header (the Otto mark; on Electron the macOS
 * traffic-light inset, the drag region and the history Back / Forward buttons),
 * the primary group (the areas, in the order of DESIGN.md; ones with no route
 * yet are shown, not linked), the section that belongs
 * to the open area (passed in as `section`: Chats brings its filters and list,
 * Settings its pages), and the footer (Settings, then the profile menu).
 * Icons only below 1024px, a sheet below 768px (see the design system's
 * `Sidebar`).
 */

import * as React from 'react'
import { useTranslation } from 'react-i18next'
import {
  ArrowLeft,
  ArrowRight,
  CircleCheck,
  Clock,
  FileText,
  Folder,
  FolderClosed,
  Inbox,
  MessagesSquare,
  Search,
  Settings,
  type LucideIcon,
} from 'lucide-react'
import { Button } from '@workspace/ui/components/button'
import { Logo } from '@workspace/ui/components/logo'
import {
  Sidebar,
  SidebarContent,
  SidebarFooter,
  SidebarGroup,
  SidebarHeader,
  SidebarMenu,
  SidebarMenuButton,
  SidebarMenuItem,
} from '@workspace/ui/components/sidebar'
import { cn } from '@/lib/utils'
import { isMac, isWebUI } from '@/lib/platform'
import { useActionLabel } from '@/actions'
import { ActionTooltip } from '@/components/ui/action-tooltip'
import { Kbd } from '@/components/ui/kbd'
import type { Workspace } from '../../../shared/types'
import { ProfileMenu } from './profile-menu'

export type SidebarArea = 'chats' | 'projects' | 'schedules' | 'documents' | 'settings'

interface AppSidebarProps {
  /** The area that is open (its row is filled). */
  active: SidebarArea | null
  onSearch: () => void
  onChats: () => void
  onProjects: () => void
  onSchedules: () => void
  onDocuments: () => void
  onSettings: () => void
  /** History navigation (Electron only: the browser has its own). */
  onBack: () => void
  onForward: () => void
  canGoBack: boolean
  canGoForward: boolean
  workspaces: Workspace[]
  activeWorkspaceId: string | null
  onSelectWorkspace: (workspaceId: string) => void | Promise<void>
  workspaceUnreadMap?: Record<string, boolean>
  onWorkspaceCreated?: (workspace: Workspace) => void
  onWorkspaceRemoved?: () => void
  /** The open area's own section (its filters, list or pages). Hidden when icons only. */
  section?: React.ReactNode
}

interface PrimaryItem {
  id: string
  icon: LucideIcon
  labelKey: string
  /** The area this row fills while open. */
  area?: SidebarArea
  /** Rows without a handler are placeholders: shown, not linked yet. */
  onSelect?: () => void
  hotkey?: string
}

// macOS draws its traffic lights over the window's top-left, only in the desktop
// app: the header clears them (the browser has none, whatever the OS).
const clearsTrafficLights = isMac && !isWebUI

export function AppSidebar({
  active,
  onSearch,
  onChats,
  onProjects,
  onSchedules,
  onDocuments,
  onSettings,
  onBack,
  onForward,
  canGoBack,
  canGoForward,
  workspaces,
  activeWorkspaceId,
  onSelectWorkspace,
  workspaceUnreadMap,
  onWorkspaceCreated,
  onWorkspaceRemoved,
  section,
}: AppSidebarProps) {
  const { t } = useTranslation()
  const searchHotkey = useActionLabel('app.search').hotkey ?? undefined
  const settingsHotkey = useActionLabel('app.settings').hotkey ?? undefined

  // A label and its key, in the tooltip, also while the row shows its label.
  const withKey = (label: string, hotkey?: string) => hotkey
    ? { children: <>{label}<Kbd>{hotkey}</Kbd></>, hidden: false }
    : label

  // The rail's order. Search opens the Chats search; the rest have a route or are placeholders.
  const primary: PrimaryItem[] = [
    { id: 'inbox', icon: Inbox, labelKey: 'sidebar.inbox' },
    { id: 'search', icon: Search, labelKey: 'sidebar.search', onSelect: onSearch, hotkey: searchHotkey },
    { id: 'tasks', icon: CircleCheck, labelKey: 'sidebar.tasks' },
    { id: 'projects', icon: Folder, labelKey: 'sidebar.projects', area: 'projects', onSelect: onProjects },
    { id: 'chats', icon: MessagesSquare, labelKey: 'sidebar.chats', area: 'chats', onSelect: onChats },
    { id: 'schedules', icon: Clock, labelKey: 'sidebar.schedules', area: 'schedules', onSelect: onSchedules },
    { id: 'documents', icon: FileText, labelKey: 'sidebar.documents', area: 'documents', onSelect: onDocuments },
    { id: 'files', icon: FolderClosed, labelKey: 'sidebar.files' },
  ]

  return (
    <Sidebar>
      <SidebarHeader
        className={cn(
          'titlebar-drag-region',
          // Icons only: the lights stay above the column, so the mark sits under them.
          clearsTrafficLights && 'group-data-[collapsible=icon]:pt-10',
        )}
      >
        <div
          className={cn(
            'flex h-7 items-center',
            // 80px in: the lights end at 70.
            clearsTrafficLights && 'pl-[68px] group-data-[collapsible=icon]:pl-0',
          )}
        >
          <div className="flex min-w-0 flex-1 items-center gap-2 pl-1 group-data-[collapsible=icon]:justify-center group-data-[collapsible=icon]:pl-0">
            <Logo className="size-5 text-foreground" title="Otto" />
          </div>
          {!isWebUI && (
            <div className="titlebar-no-drag flex shrink-0 items-center gap-0.5 group-data-[collapsible=icon]:hidden">
              <ActionTooltip action="nav.goBackAlt">
                <Button variant="ghost" size="icon-compact" aria-label={t('common.back')} disabled={!canGoBack} onClick={onBack}>
                  <ArrowLeft />
                </Button>
              </ActionTooltip>
              <ActionTooltip action="nav.goForwardAlt">
                <Button variant="ghost" size="icon-compact" aria-label={t('common.forward')} disabled={!canGoForward} onClick={onForward}>
                  <ArrowRight />
                </Button>
              </ActionTooltip>
            </div>
          )}
        </div>
      </SidebarHeader>

      <SidebarContent>
        <SidebarGroup className="shrink-0">
          <SidebarMenu>
            {primary.map((item) => (
              <SidebarMenuItem key={item.id}>
                <SidebarMenuButton
                  isActive={!!item.area && active === item.area}
                  tooltip={withKey(t(item.labelKey), item.hotkey)}
                  onClick={item.onSelect}
                  // A placeholder stays readable but is no tab stop and has no pointer.
                  {...(!item.onSelect && { 'aria-disabled': true, tabIndex: -1 })}
                >
                  <item.icon />
                  <span>{t(item.labelKey)}</span>
                </SidebarMenuButton>
              </SidebarMenuItem>
            ))}
          </SidebarMenu>
        </SidebarGroup>
        <div className="flex min-h-0 flex-1 flex-col group-data-[collapsible=icon]:hidden">{section}</div>
      </SidebarContent>

      <SidebarFooter>
        <SidebarMenu>
          <SidebarMenuItem>
            <SidebarMenuButton isActive={active === 'settings'} tooltip={withKey(t('sidebar.settings'), settingsHotkey)} onClick={onSettings}>
              <Settings />
              <span>{t('sidebar.settings')}</span>
            </SidebarMenuButton>
          </SidebarMenuItem>
          <SidebarMenuItem>
            <ProfileMenu
              workspaces={workspaces}
              activeWorkspaceId={activeWorkspaceId}
              onSelect={onSelectWorkspace}
              onSettings={onSettings}
              workspaceUnreadMap={workspaceUnreadMap}
              onWorkspaceCreated={onWorkspaceCreated}
              onWorkspaceRemoved={onWorkspaceRemoved}
            />
          </SidebarMenuItem>
        </SidebarMenu>
      </SidebarFooter>
    </Sidebar>
  )
}
