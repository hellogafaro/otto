import * as React from "react"
import { useTranslation } from "react-i18next"
import { useState, useCallback, useRef } from "react"
import { Check, FolderPlus, ChevronsUpDown, Cloud, CloudOff, Trash2 } from "lucide-react"
import { AnimatePresence } from "motion/react"
import { useSetAtom } from "jotai"
import { toast } from "sonner"

import { cn } from "@/lib/utils"
import { fullscreenOverlayOpenAtom } from "@/atoms/overlay"
import {
  DropdownMenu,
  DropdownMenuTrigger,
  StyledDropdownMenuContent,
  StyledDropdownMenuItem,
  StyledDropdownMenuSeparator,
} from "@/components/ui/styled-dropdown"
import { WorkspaceAvatar } from "@/components/ui/workspace-avatar"
import { SidebarMenuButton, useSidebar } from "@workspace/ui/components/sidebar"
import { WorkspaceCreationScreen } from "@/components/workspace"
import { waitForTransportConnected } from '@/lib/transport-wait'
import { useWorkspaceIcons } from "@/hooks/use-workspace-icon"
import { useTransportConnectionState } from "@/hooks/use-transport-connection-state"
import type { Workspace } from "../../../shared/types"

interface WorkspaceSwitcherProps {
  workspaces: Workspace[]
  activeWorkspaceId: string | null
  onSelect: (workspaceId: string) => void | Promise<void>
  onWorkspaceCreated?: (workspace: Workspace) => void
  onWorkspaceRemoved?: () => void
  /** workspaceId -> has unread */
  workspaceUnreadMap?: Record<string, boolean>
}

/**
 * WorkspaceSwitcher - the sidebar footer's workspace row (32px avatar, name, up-down
 * chevron; the avatar alone when the sidebar is icons only) and the menu it opens:
 * the workspaces, remove, and add.
 */
export function WorkspaceSwitcher({
  workspaces,
  activeWorkspaceId,
  onSelect,
  onWorkspaceCreated,
  onWorkspaceRemoved,
  workspaceUnreadMap,
}: WorkspaceSwitcherProps) {
  const { t } = useTranslation()
  const { state } = useSidebar()
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
            aria-label={t('workspace.selectWorkspace')}
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

        <StyledDropdownMenuContent
          side={state === 'collapsed' ? 'right' : 'top'}
          align={state === 'collapsed' ? 'end' : 'start'}
          sideOffset={4}
          minWidth="min-w-56"
        >
          {workspaces.map((workspace) => {
            const disconnected = isRemoteDisconnected(workspace.id)
            return (
              <StyledDropdownMenuItem
                key={workspace.id}
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
                className={cn(
                  "justify-between group",
                  activeWorkspaceId === workspace.id && "bg-foreground/10",
                  disconnected && "opacity-60",
                )}
              >
                <div className="flex items-center gap-3 font-sans min-w-0 flex-1">
                  <WorkspaceAvatar
                    workspaceId={workspace.id}
                    workspaceName={workspace.name}
                    src={workspaceIconMap.get(workspace.id)}
                    className="h-5 w-5 rounded-full ring-1 ring-border/50"
                    fallbackClassName="rounded-full text-xs"
                  />
                  <span className="truncate">{workspace.name}</span>
                  {workspace.remoteServer && (
                    disconnected
                      ? <span title={getDisconnectTooltip(workspace.id)} className="shrink-0"><CloudOff className="h-3.5 w-3.5 text-destructive" /></span>
                      : <Cloud className="h-3.5 w-3.5 text-muted-foreground shrink-0" />
                  )}
                  {workspaceUnreadMap?.[workspace.id] && <span className="h-2 w-2 rounded-full bg-primary shrink-0" />}
                </div>
                <div className="flex items-center gap-1">
                  {/* Action buttons - only visible on hover for non-active workspaces */}
                  {activeWorkspaceId !== workspace.id && (
                    <button
                      data-touch-reveal="true"
                      className="opacity-0 group-hover:opacity-100 p-0.5 rounded hover:bg-destructive/20 hover:text-destructive transition-opacity"
                      onClick={(e) => {
                        e.stopPropagation()
                        handleRemoveWorkspace(workspace)
                      }}
                      title={t("workspace.removeWorkspace")}
                    >
                      <Trash2 className="h-3.5 w-3.5" />
                    </button>
                  )}
                  {activeWorkspaceId === workspace.id && (
                    <Check className="h-3.5 w-3.5" />
                  )}
                </div>
              </StyledDropdownMenuItem>
            )
          })}

          {/* Separator and New Workspace option */}
          <StyledDropdownMenuSeparator />
          <StyledDropdownMenuItem
            onClick={handleNewWorkspace}
            className="font-sans"
          >
            <FolderPlus className="size-3.5" />
            {t("workspace.addWorkspace")}
          </StyledDropdownMenuItem>
        </StyledDropdownMenuContent>
      </DropdownMenu>
    </>
  )
}
