/**
 * AppSidebar - the shell's one sidebar, on the frame beside the page card.
 *
 * Top to bottom: the header (the Otto mark; on Electron the macOS
 * traffic-light inset, the drag region and the history Back / Forward buttons),
 * the primary group (New chat, Search, then the areas), the section that belongs
 * to the open area (passed in as `section`: Chats brings its filters and list,
 * Settings its pages), and the footer (Settings, then the workspace menu).
 * Icons only below 1024px, a sheet below 768px (see the design system's
 * `Sidebar`).
 */

import * as React from 'react'
import { useTranslation } from 'react-i18next'
import { ArrowLeft, ArrowRight, FileText, Folder, MessagesSquare, Search, Settings, SquarePen } from 'lucide-react'
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
import { WorkspaceSwitcher } from './workspace-switcher'

export type SidebarArea = 'chats' | 'projects' | 'documents' | 'settings'

interface AppSidebarProps {
  /** The area that is open (its row is filled). */
  active: SidebarArea | null
  onNewChat: () => void
  onSearch: () => void
  onChats: () => void
  onProjects: () => void
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

// macOS draws its traffic lights over the window's top-left, only in the desktop
// app: the header clears them (the browser has none, whatever the OS).
const clearsTrafficLights = isMac && !isWebUI

export function AppSidebar({
  active,
  onNewChat,
  onSearch,
  onChats,
  onProjects,
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
  const newChatHotkey = useActionLabel('app.newChat').hotkey ?? undefined
  const searchHotkey = useActionLabel('app.search').hotkey ?? undefined
  const settingsHotkey = useActionLabel('app.settings').hotkey ?? undefined

  // A label and its key, in the tooltip, also while the row shows its label.
  const withKey = (label: string, hotkey?: string) => hotkey
    ? { children: <>{label}<Kbd>{hotkey}</Kbd></>, hidden: false }
    : label

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
            <SidebarMenuItem>
              <SidebarMenuButton data-tutorial="new-chat-button" tooltip={withKey(t('menu.newChat'), newChatHotkey)} onClick={onNewChat}>
                <SquarePen />
                <span>{t('menu.newChat')}</span>
              </SidebarMenuButton>
            </SidebarMenuItem>
            <SidebarMenuItem>
              <SidebarMenuButton tooltip={withKey(t('sidebar.search'), searchHotkey)} onClick={onSearch}>
                <Search />
                <span>{t('sidebar.search')}</span>
              </SidebarMenuButton>
            </SidebarMenuItem>
            <SidebarMenuItem>
              <SidebarMenuButton isActive={active === 'chats'} tooltip={t('sidebar.chats')} onClick={onChats}>
                <MessagesSquare />
                <span>{t('sidebar.chats')}</span>
              </SidebarMenuButton>
            </SidebarMenuItem>
            <SidebarMenuItem>
              <SidebarMenuButton isActive={active === 'projects'} tooltip={t('sidebar.projects')} onClick={onProjects}>
                <Folder />
                <span>{t('sidebar.projects')}</span>
              </SidebarMenuButton>
            </SidebarMenuItem>
            <SidebarMenuItem>
              <SidebarMenuButton isActive={active === 'documents'} tooltip={t('sidebar.documents')} onClick={onDocuments}>
                <FileText />
                <span>{t('sidebar.documents')}</span>
              </SidebarMenuButton>
            </SidebarMenuItem>
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
            <WorkspaceSwitcher
              workspaces={workspaces}
              activeWorkspaceId={activeWorkspaceId}
              onSelect={onSelectWorkspace}
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
