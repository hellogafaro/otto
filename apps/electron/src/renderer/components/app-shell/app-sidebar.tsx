/**
 * AppSidebar - the shell's one sidebar, on the frame beside the page card.
 *
 * Top to bottom, five groups 20px apart (the sidebar's one gap): the header (the mark, a ghost button that opens
 * Home; on Electron the macOS traffic-light inset, the drag region and the history Back / Forward
 * buttons); Home (your unread notifications' count at the row's end) and Search (opens the command palette); the pages (ones with no route yet are shown, not
 * linked); Pinned and Recent (`SidebarPinsRecents`, the only group that scrolls,
 * none when both are empty); and the footer (the workspace menu alone, Settings inside
 * it), pinned at the bottom. Icons only below 1024px (Pinned and Recent hidden), a
 * sheet below 768px (see the design system's `Sidebar`).
 *
 * Settings is the one place that swaps the whole content (`settings`): the mark becomes Back to
 * app and the groups are Settings' own pages, with no Pinned, Recent or footer (`settings-sidebar.tsx`).
 */

import { useTranslation } from 'react-i18next'
import {
  ArrowLeft,
  ArrowRight,
  CircleCheck,
  Clock,
  Folder,
  House,
  Library,
  MessagesSquare,
  Search,
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
  SidebarMenuSlot,
} from '@workspace/ui/components/sidebar'
import { cn } from '@/lib/utils'
import { isMac, isWebUI } from '@/lib/platform'
import { useShortcutReveal } from '@/hooks/use-shortcut-reveal'
import { useNotifications } from '@/hooks/use-notifications'
import { formatUnreadCount } from '@/pages/home/notification-rules'
import { ActionTooltip } from '@/components/ui/action-tooltip'
import { Kbd } from '@/components/ui/kbd'
import { Tooltip, TooltipContent, TooltipTrigger } from '@workspace/ui/components/tooltip'
import { useActionLabel } from '@/actions'
import type { SessionStatus } from '@/config/session-status-config'
import type { Workspace } from '../../../shared/types'
import { WorkspaceMenu } from './workspace-menu'
import { SidebarPinsRecents } from './sidebar-pins-recents'
import { SettingsBackRow, SettingsSidebarContent } from './settings-sidebar'
import { useCommandPalette } from '@/components/command-palette/command-palette-provider'
import { PRODUCT_NAME } from '@otto/shared/branding'

export type SidebarArea = 'home' | 'tasks' | 'chats' | 'projects' | 'routines' | 'library'

interface AppSidebarProps {
  /** The area that is open (its row is filled). */
  active: SidebarArea | null
  onHome: () => void
  onTasks: () => void
  onChats: () => void
  onProjects: () => void
  onRoutines: () => void
  onLibrary: () => void
  onSettings: () => void
  /** Inside Settings (its pages, Skills, Sources): the sidebar shows Settings' own content. */
  settings: boolean
  /** Back to app: leaves Settings for the view it was entered from. */
  onBackToApp: () => void
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
  /** The workspace's session statuses, for the status icons of Pinned and Recent chats. */
  sessionStatuses: SessionStatus[]
}

interface NavItem {
  id: string
  icon: LucideIcon
  labelKey: string
  /** The area this row fills while open. */
  area?: SidebarArea
  /** Rows without a handler are placeholders: shown, not linked yet. */
  onSelect?: () => void
  /** A count at the row's end (Home: unread notifications), none when null. */
  count?: string | null
}

// macOS draws its traffic lights over the window's top-left, only in the desktop
// app: the header clears them (the browser has none, whatever the OS).
const clearsTrafficLights = isMac && !isWebUI

export function AppSidebar({
  active,
  onHome,
  onTasks,
  onChats,
  onProjects,
  onRoutines,
  onLibrary,
  onSettings,
  settings,
  onBackToApp,
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
  sessionStatuses,
}: AppSidebarProps) {
  const { t } = useTranslation()
  // Holding the reveal key (⌘ on desktop, Option in the browser) shows every row's key.
  const revealShortcuts = useShortcutReveal()
  const palette = useCommandPalette()
  const { unreadCount } = useNotifications()
  const homeKey = useActionLabel('nav.home').hotkey

  // Group 1: Home (the unread notifications' count, 99+ at most) and Search, the command palette.
  const homeSearch: NavItem[] = [
    { id: 'home', icon: House, labelKey: 'sidebar.home', area: 'home', onSelect: onHome, count: formatUnreadCount(unreadCount) },
    { id: 'search', icon: Search, labelKey: 'sidebar.search', onSelect: () => palette.open() },
  ]
  // Group 2: the pages, each with a route or a placeholder.
  const pages: NavItem[] = [
    { id: 'tasks', icon: CircleCheck, labelKey: 'sidebar.tasks', area: 'tasks', onSelect: onTasks },
    { id: 'projects', icon: Folder, labelKey: 'sidebar.projects', area: 'projects', onSelect: onProjects },
    { id: 'chats', icon: MessagesSquare, labelKey: 'sidebar.chats', area: 'chats', onSelect: onChats },
    { id: 'routines', icon: Clock, labelKey: 'sidebar.routines', area: 'routines', onSelect: onRoutines },
    { id: 'library', icon: Library, labelKey: 'sidebar.library', area: 'library', onSelect: onLibrary },
  ]

  return (
    <Sidebar data-reveal-shortcuts={revealShortcuts}>
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
          {settings ? (
            <SettingsBackRow onBack={onBackToApp} />
          ) : (
            // The mark is a 32px ghost button (4px around the 24px mark) that opens Home; 2px in, so the
            // mark's center stays where the 20px mark's was (26px from the sidebar's edge, on the axis).
            <div className="flex min-w-0 flex-1 items-center pl-0.5 group-data-[collapsible=icon]:justify-center group-data-[collapsible=icon]:pl-0">
              <Tooltip>
                <TooltipTrigger
                  render={(
                    <Button variant="ghost" size="icon" aria-label={t('sidebar.home')} className="titlebar-no-drag" onClick={onHome}>
                      <Logo className="size-6 text-foreground" title={PRODUCT_NAME} />
                    </Button>
                  )}
                />
                <TooltipContent side="bottom">
                  {t('sidebar.home')}
                  {homeKey && <Kbd>{homeKey}</Kbd>}
                </TooltipContent>
              </Tooltip>
            </div>
          )}
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

      {settings ? (
        <SettingsSidebarContent />
      ) : (
        <>
          <SidebarContent>
            {[homeSearch, pages].map((items, index) => (
              <SidebarGroup key={index} className="shrink-0">
                <SidebarMenu>
                  {items.map((item) => (
                    <SidebarMenuItem key={item.id}>
                      <SidebarMenuButton
                        isActive={!!item.area && active === item.area}
                        tooltip={t(item.labelKey)}
                        onClick={item.onSelect}
                        // A placeholder stays readable but is no tab stop and has no pointer.
                        {...(!item.onSelect && { 'aria-disabled': true, tabIndex: -1 })}
                      >
                        <item.icon />
                        <span>{t(item.labelKey)}</span>
                      </SidebarMenuButton>
                      {item.count && (
                        <SidebarMenuSlot>
                          <span className="px-1 text-xs text-muted-foreground tabular-nums">{item.count}</span>
                        </SidebarMenuSlot>
                      )}
                    </SidebarMenuItem>
                  ))}
                </SidebarMenu>
              </SidebarGroup>
            ))}

            <SidebarPinsRecents sessionStatuses={sessionStatuses} />
          </SidebarContent>

          <SidebarFooter>
            <SidebarMenu>
              <SidebarMenuItem>
                <WorkspaceMenu
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
        </>
      )}
    </Sidebar>
  )
}
