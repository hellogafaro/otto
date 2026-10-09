import * as React from "react"
import { useTranslation } from "react-i18next"
import { useState, useCallback, useRef } from "react"
import { ChevronsUpDown, Cloud, CloudOff, LogOut, Plus, Settings, Trash2, User } from "lucide-react"
import { AnimatePresence } from "motion/react"
import { useSetAtom } from "jotai"
import { toast } from '@workspace/ui/components/sonner'
import { logOut } from "@/lib/log-out"

import { cn } from "@/lib/utils"
import { fullscreenOverlayOpenAtom } from "@/atoms/overlay"
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuGroup,
  DropdownMenuItem,
  DropdownMenuRadioGroup,
  DropdownMenuRadioItem,
  DropdownMenuSeparator,
  DropdownMenuShortcut,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu"
import { WorkspaceAvatar } from "@/components/ui/workspace-avatar"
import { SidebarMenuButton, useSidebar } from "@workspace/ui/components/sidebar"
import { WorkspaceCreationScreen } from "@/components/workspace"
import { useActionLabel } from "@/actions"
import { navigate, routes } from "@/lib/navigate"
import { isWebUI } from "@/lib/platform"
import { waitForTransportConnected } from '@/lib/transport-wait'
import { useWorkspaceIcons } from "@/hooks/use-workspace-icon"
import { useTransportConnectionState } from "@/hooks/use-transport-connection-state"
import { readLocalAccount, useCurrentUser } from "@/hooks/use-current-user"
import type { Workspace } from "../../../shared/types"

interface WorkspaceMenuProps {
  workspaces: Workspace[]
  activeWorkspaceId: string | null
  onSelect: (workspaceId: string) => void | Promise<void>
  onSettings: () => void
  onWorkspaceCreated?: (workspace: Workspace) => void
  onWorkspaceRemoved?: () => void
}

/**
 * The menu's one leading slot: 20px at the row's 8px padding, content centered, so 20px
 * avatars fill it and 14px icons center in it (one axis, 18px in) and every label starts
 * at 8 + 20 + 8 = 36px, like the sidebar's rows. Rows are `gap-2`; none sets its own offsets.
 */
const LEAD = 'flex size-5 shrink-0 items-center justify-center'

/**
 * The trailing line: 8px in from the row's end, like the 8px side padding. Kbd, check and
 * the remove button all end on it. The design system's check sits 4px in by default
 * (`right-1`, centered in a 20px slot); here it moves to 8px and aligns to the right.
 */
const CHECK_SLOT = '[&>[data-slot=dropdown-menu-radio-item-indicator]]:right-2 [&>[data-slot=dropdown-menu-radio-item-indicator]]:justify-end'

/** Up to two initials of a name ("Ada Lovelace" -> "AL"). */
function getInitials(name: string): string {
  return name.trim().split(/\s+/).slice(0, 2).map(word => word.charAt(0)).join('').toUpperCase()
}

/**
 * WorkspaceMenu - the sidebar footer's workspace row (20px avatar, name, up-down
 * chevron; the avatar alone when the sidebar is icons only) and the menu it opens:
 * the current workspace (avatar, name), Settings, the workspaces to switch
 * to (a check on the current one, remove on hover for the others) with New
 * workspace, then the account block and, on the web only, Log out. The account
 * (name, then the email)
 * is the signed-in person on the web (static); on Electron the name and email
 * from Settings -> Preferences, a muted placeholder for each one not set, and it
 * opens that page.
 */
export function WorkspaceMenu({
  workspaces,
  activeWorkspaceId,
  onSelect,
  onSettings,
  onWorkspaceCreated,
  onWorkspaceRemoved,
}: WorkspaceMenuProps) {
  const { t } = useTranslation()
  const { state, isMobile } = useSidebar()
  // The sheet (below 768px) always shows the full row, whatever the window's icon state.
  const iconsOnly = state === 'collapsed' && !isMobile
  const settingsHotkey = useActionLabel('app.settings').hotkey ?? undefined
  const [showCreationScreen, setShowCreationScreen] = useState(false)
  const [reconnectTarget, setReconnectTarget] = useState<Workspace | null>(null)
  const setFullscreenOverlayOpen = useSetAtom(fullscreenOverlayOpenAtom)
  const selectedWorkspace = workspaces.find(w => w.id === activeWorkspaceId)
  const workspaceIconMap = useWorkspaceIcons(workspaces)
  const connectionState = useTransportConnectionState()
  const [preferencesAccount, setAccount] = useState({ name: '', email: '' })
  const sessionUser = useCurrentUser()
  const account = isWebUI ? sessionUser ?? { name: '', email: '' } : preferencesAccount
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

  /** Electron: the name and email the person set in Settings -> Preferences. */
  const loadAccount = useCallback(() => {
    if (!isWebUI) void readLocalAccount().then(setAccount)
  }, [])

  React.useEffect(loadAccount, [loadAccount])

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

  const accountBlock = (
    <>
      <span className={cn(LEAD, "rounded-xs bg-muted text-[10px] font-medium text-muted-foreground")}>
        {account.name ? getInitials(account.name) : <User />}
      </span>
      <span className="flex min-w-0 flex-1 flex-col text-left">
        <span className={cn("truncate text-sm leading-[18px] font-medium", !account.name && "text-muted-foreground")}>
          {account.name || t('workspaceMenu.accountNamePlaceholder')}
        </span>
        <span className="truncate text-xs leading-4 text-muted-foreground">
          {account.email || t('workspaceMenu.accountEmailPlaceholder')}
        </span>
      </span>
    </>
  )

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

      <DropdownMenu onOpenChange={(open) => { if (open) { checkRemoteHealth(); loadAccount() } }}>
        <DropdownMenuTrigger asChild>
          <SidebarMenuButton
            size="lg"
            aria-label={t('workspaceMenu.open')}
            tooltip={selectedWorkspace?.name}
            className="titlebar-no-drag"
          >
            <WorkspaceAvatar
              workspaceId={selectedWorkspace?.id}
              workspaceName={selectedWorkspace?.name}
              src={selectedWorkspace ? workspaceIconMap.get(selectedWorkspace.id) : undefined}
              className="size-5 rounded-xs"
              fallbackClassName="rounded-xs"
            />
            <span className="flex min-w-0 flex-1 flex-col text-left">
              <span className="truncate text-sm font-medium text-foreground">{selectedWorkspace?.name || t('workspace.selectWorkspace')}</span>
            </span>
            {selectedWorkspace?.remoteServer && (
              isRemoteDisconnected(selectedWorkspace.id)
                ? <CloudOff className="text-destructive" />
                : <Cloud />
            )}
            <ChevronsUpDown className="shrink-0" />
          </SidebarMenuButton>
        </DropdownMenuTrigger>

        <DropdownMenuContent
          side={iconsOnly ? 'right' : 'top'}
          align={iconsOnly ? 'end' : 'start'}
          sideOffset={4}
          className="w-60"
        >
          <DropdownMenuGroup>
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
                    className={cn("group", CHECK_SLOT, disconnected && "opacity-60")}
                  >
                    <span className={LEAD}>
                      <WorkspaceAvatar
                        workspaceId={workspace.id}
                        workspaceName={workspace.name}
                        src={workspaceIconMap.get(workspace.id)}
                        className="size-5 rounded-xs"
                        fallbackClassName="rounded-xs"
                      />
                    </span>
                    <span className="truncate">{workspace.name}</span>
                    {workspace.remoteServer && (
                      disconnected
                        ? <span title={getDisconnectTooltip(workspace.id)} className="shrink-0"><CloudOff className="text-destructive" /></span>
                        : <Cloud className="shrink-0 text-muted-foreground" />
                    )}
                    {/* Only non-active workspaces can be removed; it shows on hover, in the check's slot. */}
                    {activeWorkspaceId !== workspace.id && (
                      <button
                        data-touch-reveal="true"
                        className="absolute right-2 flex size-5 items-center justify-center rounded-sm opacity-0 transition-opacity group-hover:opacity-100 hover:bg-destructive/20 hover:text-destructive"
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
          </DropdownMenuGroup>
          <DropdownMenuItem onClick={handleNewWorkspace}>
            <span className={LEAD}><Plus /></span>
            {t('workspaceMenu.new')}
          </DropdownMenuItem>

          <DropdownMenuSeparator />
          <DropdownMenuItem onClick={onSettings}>
            <span className={LEAD}><Settings /></span>
            {t('sidebar.settings')}
            {settingsHotkey && <span className="ml-auto flex"><DropdownMenuShortcut>{settingsHotkey}</DropdownMenuShortcut></span>}
          </DropdownMenuItem>
          <DropdownMenuSeparator />
          {/* The account: always shown, a muted placeholder for what is not set. The same slot and text line as every row; 48px so the two lines sit 7px from the top and bottom. On Electron it opens Settings -> Preferences, where its name and email are set; on the web it is the signed-in person, a static block. */}
          {isWebUI ? (
            <div className="flex h-12 items-center gap-2 px-2 py-2">{accountBlock}</div>
          ) : (
            <DropdownMenuItem className="h-12 py-2" onClick={() => navigate(routes.view.settings('preferences'))}>
              {accountBlock}
            </DropdownMenuItem>
          )}
          {/* Electron runs against its own local server: there is no web session to end. */}
          {isWebUI && (
            <DropdownMenuItem variant="destructive" onClick={() => void logOut()}>
              <span className={LEAD}><LogOut /></span>
              {t('workspaceMenu.logOut')}
            </DropdownMenuItem>
          )}
        </DropdownMenuContent>
      </DropdownMenu>
    </>
  )
}
