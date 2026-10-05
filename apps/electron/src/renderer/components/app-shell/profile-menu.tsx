import * as React from "react"
import { useTranslation } from "react-i18next"
import { useState, useCallback, useRef } from "react"
import { FolderPlus, ChevronsUpDown, Cloud, CloudOff, Contrast, LogOut, Monitor, Moon, Settings, Sun, Trash2, Users } from "lucide-react"
import { AnimatePresence } from "motion/react"
import { useSetAtom } from "jotai"
import { toast } from "sonner"

import { cn } from "@/lib/utils"
import { fullscreenOverlayOpenAtom } from "@/atoms/overlay"
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuRadioGroup,
  DropdownMenuRadioItem,
  DropdownMenuSeparator,
  DropdownMenuShortcut,
  DropdownMenuSub,
  DropdownMenuSubContent,
  DropdownMenuSubTrigger,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu"
import { WorkspaceAvatar } from "@/components/ui/workspace-avatar"
import { SidebarMenuButton, useSidebar } from "@workspace/ui/components/sidebar"
import { WorkspaceCreationScreen } from "@/components/workspace"
import { useActionLabel } from "@/actions"
import { useTheme, type ThemeMode } from "@/context/theme-context"
import { isWebUI } from "@/lib/platform"
import { waitForTransportConnected } from '@/lib/transport-wait'
import { useWorkspaceIcons } from "@/hooks/use-workspace-icon"
import { useTransportConnectionState } from "@/hooks/use-transport-connection-state"
import type { Workspace } from "../../../shared/types"

interface ProfileMenuProps {
  workspaces: Workspace[]
  activeWorkspaceId: string | null
  onSelect: (workspaceId: string) => void | Promise<void>
  onSettings: () => void
  onWorkspaceCreated?: (workspace: Workspace) => void
  onWorkspaceRemoved?: () => void
  /** workspaceId -> has unread */
  workspaceUnreadMap?: Record<string, boolean>
}

const THEME_MODES = [
  { mode: 'light', labelKey: 'settings.appearance.light', icon: Sun },
  { mode: 'dark', labelKey: 'settings.appearance.dark', icon: Moon },
  { mode: 'system', labelKey: 'settings.appearance.system', icon: Monitor },
] as const

/**
 * ProfileMenu - the sidebar footer's workspace row (32px avatar, name, up-down
 * chevron; the avatar alone when the sidebar is icons only) and the profile menu it
 * opens: the workspace's name, a Workspace submenu (the workspaces, remove, add),
 * Settings, an Appearance submenu (Light, Dark, System) and, on the web only, Log out.
 */
export function ProfileMenu({
  workspaces,
  activeWorkspaceId,
  onSelect,
  onSettings,
  onWorkspaceCreated,
  onWorkspaceRemoved,
  workspaceUnreadMap,
}: ProfileMenuProps) {
  const { t } = useTranslation()
  const { state, isMobile } = useSidebar()
  // The sheet (below 768px) always shows the full row, whatever the window's icon state.
  const iconsOnly = state === 'collapsed' && !isMobile
  const { mode, setMode } = useTheme()
  const settingsHotkey = useActionLabel('app.settings').hotkey ?? undefined
  const [showCreationScreen, setShowCreationScreen] = useState(false)
  const [reconnectTarget, setReconnectTarget] = useState<Workspace | null>(null)
  const setFullscreenOverlayOpen = useSetAtom(fullscreenOverlayOpenAtom)
  const selectedWorkspace = workspaces.find(w => w.id === activeWorkspaceId)
  const workspaceIconMap = useWorkspaceIcons(workspaces)
  const connectionState = useTransportConnectionState()
  const isRemote = connectionState?.mode === 'remote'

  // Health check results for non-active remote workspaces (checked on dropdown open)
  const [remoteHealthMap, setRemoteHealthMap] = useState<Map<string, 'ok' | 'error' | 'checking'>>(new Map())
  const healthCheckAbort = useRef<AbortController | null>(null)

  /** Check connectivity for all non-active remote workspaces when dropdown opens. */
  const checkRemoteHealth = useCallback(() => {
    // Cancel any in-flight checks
    healthCheckAbort.current?.abort()
    const abort = new AbortController()
    healthCheckAbort.current = abort

    const remoteWorkspaces = workspaces.filter(w => w.remoteServer && w.id !== activeWorkspaceId)
    if (remoteWorkspaces.length === 0) return

    // Mark all as checking
    setRemoteHealthMap(prev => {
      const next = new Map(prev)
      for (const ws of remoteWorkspaces) next.set(ws.id, 'checking')
      return next
    })

    // Fire parallel checks
    for (const ws of remoteWorkspaces) {
      window.electronAPI.testRemoteConnection(ws.remoteServer!.url, ws.remoteServer!.token)
        .then(result => {
          if (abort.signal.aborted) return
          setRemoteHealthMap(prev => new Map(prev).set(ws.id, result.ok ? 'ok' : 'error'))
        })
        .catch(() => {
          if (abort.signal.aborted) return
          setRemoteHealthMap(prev => new Map(prev).set(ws.id, 'error'))
        })
    }
  }, [workspaces, activeWorkspaceId])

  /** Tooltip for disconnected remote workspaces — shows error kind. */
  const getDisconnectTooltip = (workspaceId: string): string => {
    if (workspaceId === activeWorkspaceId && connectionState?.lastError) {
      const { kind } = connectionState.lastError
      if (kind === 'auth') return t('toast.authenticationFailed')
      if (kind === 'timeout') return t('toast.serverUnreachable')
      if (kind === 'network') return t('toast.serverUnreachable')
    }
    return t('toast.disconnected')
  }

  /** True when we know a remote workspace is unreachable. */
  const isRemoteDisconnected = (workspaceId: string) => {
    // Active workspace: use live transport state
    if (workspaceId === activeWorkspaceId) {
      if (!isRemote || !connectionState) return false
      const { status } = connectionState
      return status !== 'connected' && status !== 'connecting' && status !== 'idle'
    }
    // Non-active: use health check result
    return remoteHealthMap.get(workspaceId) === 'error'
  }

  const hasUnreadInOtherWorkspaces = React.useMemo(() => {
    if (!activeWorkspaceId || !workspaceUnreadMap) return false
    return workspaces.some((workspace) => workspace.id !== activeWorkspaceId && workspaceUnreadMap[workspace.id])
  }, [workspaces, activeWorkspaceId, workspaceUnreadMap])

  const handleNewWorkspace = () => {
    setShowCreationScreen(true)
    setFullscreenOverlayOpen(true)
  }

  const handleWorkspaceCreated = (workspace: Workspace) => {
    setShowCreationScreen(false)
    setFullscreenOverlayOpen(false)
    toast.success(t('toast.createdWorkspace', { name: workspace.name }))
    onWorkspaceCreated?.(workspace)
    onSelect(workspace.id)
  }

  const handleRemoveWorkspace = useCallback(async (workspace: Workspace) => {
    if (workspace.id === activeWorkspaceId) {
      toast.error(t('toast.cannotRemoveActiveWorkspace'))
      return
    }
    const removed = await window.electronAPI.removeWorkspace(workspace.id)
    if (removed) {
      toast.success(t('toast.removedWorkspace', { name: workspace.name }))
      onWorkspaceRemoved?.()
    }
  }, [activeWorkspaceId, onWorkspaceRemoved])

  const handleCloseCreationScreen = useCallback(() => {
    setShowCreationScreen(false)
    setReconnectTarget(null)
    setFullscreenOverlayOpen(false)
  }, [setFullscreenOverlayOpen])

  const handleReconnectWorkspace = useCallback(async (workspaceId: string, remoteServer: { url: string; token: string; remoteWorkspaceId: string }) => {
    await window.electronAPI.updateWorkspaceRemoteServer(workspaceId, remoteServer)

    if (workspaceId === activeWorkspaceId) {
      await window.electronAPI.reconnectTransport()
      await waitForTransportConnected(window.electronAPI)
    } else {
      await Promise.resolve(onSelect(workspaceId))
      await waitForTransportConnected(window.electronAPI)
    }

    handleCloseCreationScreen()
    toast.success(t('toast.workspaceReconnected'))
  }, [activeWorkspaceId, handleCloseCreationScreen, onSelect])

  /** Web only: the server clears the session cookie, then the login page takes over. */
  const handleLogOut = useCallback(async () => {
    try {
      const response = await fetch('/api/auth/logout', { method: 'POST', credentials: 'include' })
      if (!response.ok) throw new Error(`Log out failed (${response.status})`)
      window.location.assign('/login')
    } catch {
      toast.error(t('toast.couldNotLogOut'))
    }
  }, [t])

  return (
    <>
      {/* Full-screen workspace creation overlay */}
      <AnimatePresence>
        {showCreationScreen && (
          <WorkspaceCreationScreen
            onWorkspaceCreated={handleWorkspaceCreated}
            onClose={handleCloseCreationScreen}
            reconnectWorkspace={reconnectTarget ?? undefined}
            onReconnectWorkspace={handleReconnectWorkspace}
          />
        )}
      </AnimatePresence>

      <DropdownMenu onOpenChange={(open) => { if (open) checkRemoteHealth() }}>
        <DropdownMenuTrigger asChild>
          <SidebarMenuButton
            size="lg"
            aria-label={t('profileMenu.open')}
            tooltip={selectedWorkspace?.name}
            className="titlebar-no-drag data-popup-open:bg-sidebar-accent/60 data-popup-open:text-foreground"
          >
            <WorkspaceAvatar
              workspaceId={selectedWorkspace?.id}
              workspaceName={selectedWorkspace?.name}
              src={selectedWorkspace ? workspaceIconMap.get(selectedWorkspace.id) : undefined}
              className="size-8 rounded-md"
              fallbackClassName="rounded-md text-sm"
            />
            <span className="flex min-w-0 flex-1 flex-col text-left">
              <span className="truncate text-sm font-medium text-foreground">{selectedWorkspace?.name || t('workspace.selectWorkspace')}</span>
            </span>
            {selectedWorkspace?.remoteServer && (
              isRemoteDisconnected(selectedWorkspace.id)
                ? <CloudOff className="text-destructive" />
                : <Cloud />
            )}
            {hasUnreadInOtherWorkspaces && <span className="size-2 shrink-0 rounded-full bg-primary" />}
            <ChevronsUpDown className="shrink-0" />
          </SidebarMenuButton>
        </DropdownMenuTrigger>

        <DropdownMenuContent
          side={iconsOnly ? 'right' : 'top'}
          align={iconsOnly ? 'end' : 'start'}
          sideOffset={4}
          className="w-56"
        >
          <DropdownMenuLabel className="truncate">{selectedWorkspace?.name}</DropdownMenuLabel>

          <DropdownMenuSub>
            <DropdownMenuSubTrigger>
              <Users />
              {t('profileMenu.workspace')}
            </DropdownMenuSubTrigger>
            <DropdownMenuSubContent className="min-w-56">
              <DropdownMenuRadioGroup value={activeWorkspaceId ?? ''}>
                {workspaces.map((workspace) => {
                  const disconnected = isRemoteDisconnected(workspace.id)
                  return (
                    <DropdownMenuRadioItem
                      key={workspace.id}
                      value={workspace.id}
                      closeOnClick
                      onClick={() => {
                        if (disconnected && workspace.remoteServer) {
                          setReconnectTarget(workspace)
                          setShowCreationScreen(true)
                          setFullscreenOverlayOpen(true)
                          return
                        }
                        if (disconnected) return
                        onSelect(workspace.id)
                      }}
                      className={cn("group", disconnected && "opacity-60")}
                    >
                      <WorkspaceAvatar
                        workspaceId={workspace.id}
                        workspaceName={workspace.name}
                        src={workspaceIconMap.get(workspace.id)}
                        className="size-5 rounded-full ring-1 ring-border/50"
                        fallbackClassName="rounded-full text-xs"
                      />
                      <span className="truncate">{workspace.name}</span>
                      {workspace.remoteServer && (
                        disconnected
                          ? <span title={getDisconnectTooltip(workspace.id)} className="shrink-0"><CloudOff className="text-destructive" /></span>
                          : <Cloud className="shrink-0 text-muted-foreground" />
                      )}
                      {workspaceUnreadMap?.[workspace.id] && <span className="size-2 shrink-0 rounded-full bg-primary" />}
                      {/* Only non-active workspaces can be removed; it shows on hover, in the check's slot. */}
                      {activeWorkspaceId !== workspace.id && (
                        <button
                          data-touch-reveal="true"
                          className="absolute right-1 flex size-5 items-center justify-center rounded-sm opacity-0 transition-opacity group-hover:opacity-100 hover:bg-destructive/20 hover:text-destructive"
                          onClick={(e) => {
                            e.stopPropagation()
                            handleRemoveWorkspace(workspace)
                          }}
                          title={t("workspace.removeWorkspace")}
                        >
                          <Trash2 className="size-3.5" />
                        </button>
                      )}
                    </DropdownMenuRadioItem>
                  )
                })}
              </DropdownMenuRadioGroup>
              <DropdownMenuSeparator />
              <DropdownMenuItem onClick={handleNewWorkspace}>
                <FolderPlus />
                {t("workspace.addWorkspace")}
              </DropdownMenuItem>
            </DropdownMenuSubContent>
          </DropdownMenuSub>

          <DropdownMenuItem onClick={onSettings}>
            <Settings />
            {t('sidebar.settings')}
            {settingsHotkey && <DropdownMenuShortcut>{settingsHotkey}</DropdownMenuShortcut>}
          </DropdownMenuItem>

          <DropdownMenuSub>
            <DropdownMenuSubTrigger>
              <Contrast />
              {t('profileMenu.appearance')}
            </DropdownMenuSubTrigger>
            <DropdownMenuSubContent>
              <DropdownMenuRadioGroup value={mode} onValueChange={(value) => setMode(value as ThemeMode)}>
                {THEME_MODES.map(({ mode: value, labelKey, icon: Icon }) => (
                  <DropdownMenuRadioItem key={value} value={value}>
                    <Icon />
                    {t(labelKey)}
                  </DropdownMenuRadioItem>
                ))}
              </DropdownMenuRadioGroup>
            </DropdownMenuSubContent>
          </DropdownMenuSub>

          {/* Electron runs against its own local server: there is no web session to end. */}
          {isWebUI && (
            <>
              <DropdownMenuSeparator />
              <DropdownMenuItem variant="destructive" onClick={handleLogOut}>
                <LogOut />
                {t('profileMenu.logOut')}
              </DropdownMenuItem>
            </>
          )}
        </DropdownMenuContent>
      </DropdownMenu>
    </>
  )
}
