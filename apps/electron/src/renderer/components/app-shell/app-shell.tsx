import * as React from "react"
import { useRef, useState, useEffect, useCallback, useMemo } from "react"
import { useAtomValue } from "jotai"
import { useSession } from "@/hooks/use-session"
import { ensureSessionMessagesLoadedAtom } from "@/atoms/sessions"
import { AppShellProvider, type AppShellContextType } from "@/context/app-shell-context"
import { EscapeInterruptProvider, useEscapeInterrupt } from "@/context/escape-interrupt-context"
import { useTheme } from "@/context/theme-context"
import { useAction } from "@/actions"
import { useFocusContext } from "@/context/focus-context"
import { useSetAtom } from "jotai"
import type { LoadedSource, LoadedSkill, PermissionMode } from "../../../shared/types"
import { sessionMetaMapAtom, sendToWorkspaceAtom } from "@/atoms/sessions"
import { sourcesAtom } from "@/atoms/sources"
import { DECISION_SETTINGS_CHANGED_EVENT, guardedModeAvailableAtom } from "@/atoms/permission-modes"
import { DEFAULT_PERMISSION_MODES } from "@otto/shared/agent/modes"
import { skillsAtom } from "@/atoms/skills"
import { currentSessionIdAtom } from "@/atoms/current-route"
import { type SessionStatus, statusConfigsToSessionStatuses } from "@/config/session-status-config"
import { useStatuses } from "@/hooks/use-statuses"
import { useLabels } from "@/hooks/use-labels"
import { sortLabelsForDisplay } from "@otto/shared/labels"
import { navigate, routes } from "@/lib/navigate"
import {
  useNavigation,
  useNavigationState,
  isSessionsNavigation,
  isAutomationsNavigation,
  isProjectsNavigation,
  isLibraryNavigation,
  isTasksNavigation,
  isInboxNavigation,
  isSettingsNavigation,
  isSkillsNavigation,
  isSourcesNavigation,
} from "@/contexts/navigation-context"
import { useRecordRecent } from "@/hooks/use-recents"
import { useJumpShortcuts } from "@/hooks/use-jump-shortcuts"
import { SidebarProvider, useSidebar } from "@workspace/ui/components/sidebar"
import { PageFrame } from "@workspace/ui/components/page-frame"
import { useIsMobile } from "@workspace/ui/hooks/use-mobile"
import { AppSidebar, type SidebarArea } from "./app-sidebar"
import { MainContentPanel } from "./main-content-panel"
import { SidecarHost, SidecarProvider } from "@/context/sidecar-context"
import { ComposerProvider } from "@/components/composer/composer-provider"
import { ShellComposer } from "@/components/composer/shell-composer"
import { isWebUI } from "@/lib/platform"
import { SendToWorkspaceDialog } from "./send-to-workspace-dialog"
import { MessagingDialogHost } from "@/components/messaging/messaging-dialog-host"
import { CommandPaletteProvider } from "@/components/command-palette/command-palette-provider"
import { hasOpenOverlay } from "@/lib/overlay-detection"
import { clearSourceIconCaches } from "@/lib/icon-cache"
import { buildRouteFromNavigationState } from "../../../shared/route-parser"
import type { Route } from "../../../shared/routes"

/**
 * AppShellProps - Minimal props interface for AppShell component
 *
 * Data and callbacks come via contextValue (AppShellContextType).
 * Only UI-specific state is passed as separate props.
 *
 * Adding new features:
 * 1. Add to AppShellContextType in context/app-shell-context.tsx
 * 2. Update app.tsx to include in contextValue
 * 3. Use via useAppShellContext() hook in child components
 */
interface AppShellProps {
  /** All data and callbacks - passed directly to AppShellProvider */
  contextValue: AppShellContextType
  /** UI-specific props */
  menuNewChatTrigger?: number
}


/** Below 768px the sidebar is a sheet: choosing something closes it. */
function CloseSheetOnNavigate() {
  const navState = useNavigationState()
  const { setOpenMobile } = useSidebar()
  const key = JSON.stringify(navState)
  useEffect(() => {
    setOpenMobile(false)
  }, [key, setOpenMobile])
  return null
}

/**
 * AppShell - the shell: the sidebar and the page frame
 *
 * Layout: [Sidebar (header, areas, the open area's section, footer)] [PageFrame: the page's column (its title row first), the chat's pinned row, the composer bar, sidecar]
 *
 * Session Filters:
 * - 'allSessions': Shows all sessions
 * - 'flagged': Shows flagged sessions
 * - 'state': Shows sessions with a specific todo state
 */
export function AppShell(props: AppShellProps) {
  // Wrap with EscapeInterruptProvider so AppShellContent can use useEscapeInterrupt
  return (
    <EscapeInterruptProvider>
      <AppShellContent {...props} />
    </EscapeInterruptProvider>
  )
}

/**
 * AppShellContent - Inner component that contains all the AppShell logic
 * Separated to allow useEscapeInterrupt hook to work (must be inside provider)
 */
function AppShellContent({
  contextValue,
  menuNewChatTrigger,
}: AppShellProps) {
  // Destructure commonly used values from context
  // Note: sessions is NOT destructured here - we use sessionMetaMapAtom instead
  // to prevent closures from retaining the full messages array
  const {
    workspaces,
    activeWorkspaceId,
    onSelectWorkspace,
    onRefreshWorkspaces,
    onDeleteSession,
    onOpenSettings,
    onOpenKeyboardShortcuts,
  } = contextValue

  // Get hotkey labels from centralized action registry

  // Below 768px the sidebar is a sheet and the page card is full bleed.
  const isAutoCompact = useIsMobile()

  const [session, setSession] = useSession()
  const { resolvedMode, isDark, setMode } = useTheme()
  const { canGoBack, canGoForward, goBack, goForward } = useNavigation()

  // Double-Esc interrupt feature: first Esc shows warning, second Esc interrupts
  const { handleEscapePress } = useEscapeInterrupt()

  // UNIFIED NAVIGATION STATE - single source of truth from NavigationContext
  const navState = useNavigationState()
  const currentSessionId = useAtomValue(currentSessionIdAtom)

  // Sources state (workspace-scoped), null until loaded
  const [sources, setSources] = React.useState<LoadedSource[] | null>(null)
  // Sync sources to the atom the Sources grid, Previous / Next and the palette read
  const setSourcesAtom = useSetAtom(sourcesAtom)
  React.useEffect(() => {
    setSourcesAtom(sources)
  }, [sources, setSourcesAtom])

  // Skills state (workspace-scoped), null until loaded
  const [skills, setSkills] = React.useState<LoadedSkill[] | null>(null)
  // Sync skills to the atom the Skills grid, Previous / Next and the palette read
  const setSkillsAtom = useSetAtom(skillsAtom)
  React.useEffect(() => {
    setSkillsAtom(skills)
  }, [skills, setSkillsAtom])
  const activeWorkspace = workspaces.find(w => w.id === activeWorkspaceId)

  // Send to Workspace dialog state (driven by sendToWorkspaceAtom set from SessionMenu/BatchSessionMenu)
  const sendToWorkspaceIds = useAtomValue(sendToWorkspaceAtom)
  const setSendToWorkspaceIds = useSetAtom(sendToWorkspaceAtom)
  const handleTransferComplete = useCallback((targetWorkspaceId: string, _newSessionIds: string[]) => {
    onSelectWorkspace(targetWorkspaceId)
  }, [onSelectWorkspace])

  // Enabled permission modes for Shift+Tab cycling (min 2 modes)
  const [enabledModes, setEnabledModes] = React.useState<PermissionMode[]>(['safe', 'ask', 'allow-all'])

  // Load workspace settings (cyclablePermissionModes) on workspace change
  React.useEffect(() => {
    if (!activeWorkspaceId) return
    window.electronAPI.getWorkspaceSettings(activeWorkspaceId).then((settings) => {
      if (settings) {
        // Load cyclablePermissionModes from workspace settings
        if (settings.cyclablePermissionModes && settings.cyclablePermissionModes.length >= 2) {
          setEnabledModes(settings.cyclablePermissionModes)
        }
      }
    }).catch((err) => {
      console.error('[Chat] Failed to load workspace settings:', err)
    })
  }, [activeWorkspaceId])

  // Guarded permission mode is offered while the decision layer and its `guardedMode` feature
  // are on, on the server this workspace talks to. Refreshed on workspace switch and when the AI
  // settings page saves decision model settings.
  const guardedModeAvailable = useAtomValue(guardedModeAvailableAtom)
  const setGuardedModeAvailable = useSetAtom(guardedModeAvailableAtom)
  React.useEffect(() => {
    if (!activeWorkspaceId || typeof window.electronAPI?.getDecisionLayerStatus !== 'function') return
    let cancelled = false
    const refresh = () => {
      window.electronAPI.getDecisionLayerStatus().then((status) => {
        // Offered only when the check can actually run: switched on and a key (or keyless provider) to call it with.
        const { settings } = status
        const preset = status.presets.find(p => p.id === settings.provider)
        const hasKey = !!settings.connectionSlug || status.providersWithKey.includes(settings.provider) || preset?.requiresKey === false
        if (!cancelled) setGuardedModeAvailable(settings.enabled && settings.features.guardedMode === true && hasKey)
      }).catch((err) => {
        console.error('[AppShell] Failed to load decision model status:', err)
        if (!cancelled) setGuardedModeAvailable(false)
      })
    }
    refresh()
    window.addEventListener(DECISION_SETTINGS_CHANGED_EVENT, refresh)
    return () => {
      cancelled = true
      window.removeEventListener(DECISION_SETTINGS_CHANGED_EVENT, refresh)
    }
  }, [activeWorkspaceId, setGuardedModeAvailable])

  // Load sources from backend on mount
  React.useEffect(() => {
    if (!activeWorkspaceId) return
    window.electronAPI.getSources(activeWorkspaceId).then((loaded) => {
      setSources(loaded || [])
    }).catch(err => {
      console.error('[Chat] Failed to load sources:', err)
    })
  }, [activeWorkspaceId])

  // Subscribe to live source updates (when sources are added/removed dynamically)
  React.useEffect(() => {
    const cleanup = window.electronAPI.onSourcesChanged((workspaceId, updatedSources) => {
      if (workspaceId !== activeWorkspaceId) return
      // Clear icon cache so updated source icons are re-fetched on render
      clearSourceIconCaches()
      setSources(updatedSources || [])
    })
    return cleanup
  }, [activeWorkspaceId])

  // Subscribe to live skill updates (when skills are added/removed dynamically)
  React.useEffect(() => {
    const cleanup = window.electronAPI.onSkillsChanged((workspaceId, updatedSkills) => {
      if (workspaceId !== activeWorkspaceId) return
      setSkills(updatedSkills || [])
    })
    return cleanup
  }, [activeWorkspaceId])

  // Handle session source selection changes
  const handleSessionSourcesChange = React.useCallback(async (sessionId: string, sourceSlugs: string[]) => {
    try {
      await window.electronAPI.sessionCommand(sessionId, { type: 'setSources', sourceSlugs })
      // Session will emit a 'sources_changed' event that updates the session state
    } catch (err) {
      console.error('[Chat] Failed to set session sources:', err)
    }
  }, [])

  // Handle session label changes (add/remove via # menu or badge X)
  const handleSessionLabelsChange = React.useCallback(async (sessionId: string, labels: string[]) => {
    try {
      await window.electronAPI.sessionCommand(sessionId, { type: 'setLabels', labels })
      // Session will emit a 'labels_changed' event that updates the session state
    } catch (err) {
      console.error('[Chat] Failed to set session labels:', err)
    }
  }, [])


  // Load dynamic statuses from workspace config
  const { statuses: statusConfigs } = useStatuses(activeWorkspace?.id || null)
  const [sessionStatuses, setSessionStatuses] = React.useState<SessionStatus[]>([])

  // Convert StatusConfig to SessionStatus with resolved icons
  React.useEffect(() => {
    if (!activeWorkspace?.id || statusConfigs.length === 0) {
      setSessionStatuses([])
      return
    }

    setSessionStatuses(statusConfigsToSessionStatuses(statusConfigs, activeWorkspace.id, isDark))
  }, [statusConfigs, activeWorkspace?.id, isDark])

  // Load labels from workspace config
  const { labels: labelConfigs } = useLabels(activeWorkspace?.id || null)
  const displayLabelConfigs = useMemo(() => sortLabelsForDisplay(labelConfigs), [labelConfigs])

  // Ensure session messages are loaded when selected
  const ensureMessagesLoaded = useSetAtom(ensureSessionMessagesLoadedAtom)

  // Focus zone management
  const { focusZone, focusNextZone } = useFocusContext()

  // Global keyboard shortcuts using centralized action registry
  // Actions are defined in @/actions/definitions.ts

  // Pins and recents: record the open chat, and ⌘1–⌘9 (Option+1–9 in the browser) open the Nth item
  useRecordRecent()
  useJumpShortcuts()

  // Tab navigation between zones
  useAction('nav.nextZone', () => {
    focusNextZone()
  }, { enabled: () => !document.querySelector('[role="dialog"]') })

  // Shift+Tab cycles permission mode through enabled modes (textarea handles its own, this handles when focus is elsewhere)
  const effectiveSessionId = currentSessionId ?? session.selected

  useAction('chat.cyclePermissionMode', () => {
    if (effectiveSessionId) {
      const currentOptions = contextValue.sessionOptions.get(effectiveSessionId)
      const currentMode = currentOptions?.permissionMode ?? 'ask'
      // Cycle through enabled permission modes. An unavailable Guarded behaves as Ask, so it
      // stands in as Ask (never re-adding Execute the user left out of the cycle).
      const base = enabledModes.length >= 2 ? enabledModes : DEFAULT_PERMISSION_MODES
      const listed = base
        .map(mode => (mode === 'guarded' && !guardedModeAvailable ? 'ask' : mode))
        .filter((mode, index, all) => all.indexOf(mode) === index)
      const modes = listed.length >= 2 ? listed : (['safe', 'ask'] as PermissionMode[])
      const currentIndex = modes.indexOf(currentMode)
      // If current mode not in enabled list, jump to first enabled mode
      const nextIndex = currentIndex === -1 ? 0 : (currentIndex + 1) % modes.length
      const nextMode = modes[nextIndex]
      contextValue.onSessionOptionsChange(effectiveSessionId, { permissionMode: nextMode })
    }
  })

  // New chat
  useAction('app.newChat', () => handleNewChat())

  // Settings
  useAction('app.settings', onOpenSettings)

  // Keyboard shortcuts
  useAction('app.keyboardShortcuts', onOpenKeyboardShortcuts)

  // Quit (note: also handled by native menu on macOS)
  useAction('app.quit', () => window.electronAPI.menuQuit())

  // History navigation
  useAction('nav.goBack', goBack)
  useAction('nav.goForward', goForward)

  // History navigation (arrow key alternatives)
  useAction('nav.goBackAlt', goBack)
  useAction('nav.goForwardAlt', goForward)

  // ESC to stop processing - requires double-press within 1 second
  // First press shows warning overlay, second press interrupts
  useAction('chat.stopProcessing', () => {
    if (effectiveSessionId) {
      const meta = sessionMetaMap.get(effectiveSessionId)
      if (meta?.isProcessing) {
        // handleEscapePress returns true on second press (within timeout)
        const shouldInterrupt = handleEscapePress()
        if (shouldInterrupt) {
          window.electronAPI.cancelProcessing(effectiveSessionId, false).catch(err => {
            console.error('[AppShell] Failed to cancel processing:', err)
          })
        }
      }
    }
  }, {
    // Only active when no overlay is open and session is processing
    // Overlays (dialogs, menus, popovers, etc.) should handle their own Escape
    enabled: () => {
      if (hasOpenOverlay()) return false
      if (!effectiveSessionId) return false
      const meta = sessionMetaMap.get(effectiveSessionId)
      return meta?.isProcessing ?? false
    }
  }, [effectiveSessionId, handleEscapePress])

  // Theme toggle (CMD+SHIFT+A)
  useAction('app.toggleTheme', () => setMode(resolvedMode === 'dark' ? 'light' : 'dark'))

  // Global paste listener for file attachments
  // Fires when Cmd+V is pressed anywhere in the app (not just textarea)
  React.useEffect(() => {
    const handleGlobalPaste = (e: ClipboardEvent) => {
      // Skip if a dialog or menu is open
      if (document.querySelector('[role="dialog"], [role="menu"]')) {
        return
      }

      // Skip if there are no files in the clipboard
      const files = e.clipboardData?.files
      if (!files || files.length === 0) return

      // Skip if the active element is an input/textarea/contenteditable (let it handle paste directly)
      const activeElement = document.activeElement as HTMLElement | null
      if (
        activeElement?.tagName === 'TEXTAREA' ||
        activeElement?.tagName === 'INPUT' ||
        activeElement?.isContentEditable
      ) {
        return
      }

      // Prevent default paste behavior
      e.preventDefault()

      // Dispatch custom event for FreeFormInput to handle (target focused session only)
      const filesArray = Array.from(files)
      const targetSessionId = currentSessionId ?? session.selected
      if (!targetSessionId) return
      window.dispatchEvent(new CustomEvent('otto:paste-files', {
        detail: { files: filesArray, sessionId: targetSessionId }
      }))
    }

    document.addEventListener('paste', handleGlobalPaste)
    return () => document.removeEventListener('paste', handleGlobalPaste)
  }, [currentSessionId, session.selected])

  // Use session metadata from Jotai atom (lightweight, no messages)
  // This prevents closures from retaining full message arrays
  const sessionMetaMap = useAtomValue(sessionMetaMapAtom)
  // Workspace-level unread indicators (needed for workspace selectors across all workspaces)
  const [workspaceUnreadMap, setWorkspaceUnreadMap] = useState<Record<string, boolean>>({})

  // Reload skills when active session's workingDirectory changes (for project-level skills)
  // Skills are loaded from: global (~/.agents/skills/), workspace, and project ({workingDirectory}/.agents/skills/)
  const activeSessionWorkingDirectory = session.selected
    ? sessionMetaMap.get(session.selected)?.workingDirectory
    : undefined
  React.useEffect(() => {
    if (!activeWorkspaceId) return
    window.electronAPI.getSkills(activeWorkspaceId, activeSessionWorkingDirectory).then((loaded) => {
      setSkills(loaded || [])
    }).catch(err => {
      console.error('[Chat] Failed to load skills:', err)
    })
  }, [activeWorkspaceId, activeSessionWorkingDirectory])

  // Filter session metadata by active workspace
  // Also exclude hidden sessions (mini-agent sessions) from all counts and lists
  // For remote workspaces, sessions have the remote workspace ID (not the local one),
  // so we match against both the local and remote workspace IDs.
  const remoteWorkspaceId = activeWorkspace?.remoteServer?.remoteWorkspaceId
  const workspaceSessionMetas = useMemo(() => {
    const metas = Array.from(sessionMetaMap.values())
    if (!activeWorkspaceId) return metas.filter(s => !s.hidden)
    return metas.filter(s =>
      !s.hidden && (s.workspaceId === activeWorkspaceId || (remoteWorkspaceId && s.workspaceId === remoteWorkspaceId))
    )
  }, [sessionMetaMap, activeWorkspaceId, remoteWorkspaceId])

  // Active sessions exclude archived - use this for all counts and filters except archived view
  const activeSessionMetas = useMemo(() => {
    return workspaceSessionMetas.filter(s => !s.isArchived)
  }, [workspaceSessionMetas])

  const refreshWorkspaceUnreadMap = useCallback(async () => {
    try {
      const summary = await window.electronAPI.getUnreadSummary()
      const next: Record<string, boolean> = {}

      for (const workspace of workspaces) {
        next[workspace.id] = !!summary.hasUnreadByWorkspace[workspace.id]
      }

      setWorkspaceUnreadMap(next)
    } catch (error) {
      console.error('[AppShell] Failed to refresh workspace unread indicators:', error)
    }
  }, [workspaces])

  // Initial + workspace-list refresh
  useEffect(() => {
    void refreshWorkspaceUnreadMap()
  }, [refreshWorkspaceUnreadMap])

  // Keep active workspace unread indicator in sync with live metadata updates
  useEffect(() => {
    if (!activeWorkspaceId) return
    const activeHasUnread = activeSessionMetas.some((session) => !!session.hasUnread)
    setWorkspaceUnreadMap((prev) => ({ ...prev, [activeWorkspaceId]: activeHasUnread }))
  }, [activeWorkspaceId, activeSessionMetas])

  // Keep cross-workspace indicators in sync with global unread updates from main process
  useEffect(() => {
    const cleanup = window.electronAPI.onUnreadSummaryChanged((summary) => {
      const next: Record<string, boolean> = {}
      for (const workspace of workspaces) {
        next[workspace.id] = !!summary.hasUnreadByWorkspace[workspace.id]
      }
      setWorkspaceUnreadMap(next)
    })

    return cleanup
  }, [workspaces])

  // Ensure session messages are loaded when selected
  React.useEffect(() => {
    if (session.selected) {
      ensureMessagesLoaded(session.selected)
    }
  }, [session.selected, ensureMessagesLoaded])

  // Create a new chat and select it
  const handleNewChat = useCallback(() => {
    if (!activeWorkspace) return

    // A chat started under a status or label filter gets that status or label.
    const filter = isSessionsNavigation(navState) ? navState.filter : null
    const inherited = filter?.kind === 'state'
      ? { status: filter.stateId }
      : filter?.kind === 'label' && filter.labelId !== '__all__'
        ? { label: filter.labelId }
        : undefined

    // Delegate to NavigationContext which handles session creation
    navigate(routes.action.newSession(inherited))

    // Focus the chat input after navigation completes
    setTimeout(() => focusZone('chat', { intent: 'programmatic' }), 50)
  }, [activeWorkspace, focusZone, navState])

  // Wrap delete handler to clear selection when deleting the currently selected session
  // This prevents stale state during re-renders that could cause crashes
  const handleDeleteSession = useCallback(async (sessionId: string, skipConfirmation?: boolean): Promise<boolean> => {
    // Clear selection first if this is the selected session
    const wasOpen = session.selected === sessionId
    if (wasOpen) {
      setSession({ selected: null })
    }
    const deleted = await onDeleteSession(sessionId, skipConfirmation)
    // The open chat is gone: back to the index it was opened from.
    if (deleted && wasOpen && isSessionsNavigation(navState) && navState.details?.sessionId === sessionId) {
      navigate(buildRouteFromNavigationState({ ...navState, details: null }) as Route)
    }
    return deleted
  }, [session.selected, setSession, onDeleteSession, navState])

  // Extend context value with local overrides (wrapped onDeleteSession, sources, skills, labels, enabledModes, sessionStatuses)
  const appShellContextValue = React.useMemo<AppShellContextType>(() => ({
    ...contextValue,
    onDeleteSession: handleDeleteSession,
    enabledSources: sources ?? [],
    skills: skills ?? [],
    activeSessionWorkingDirectory,
    labels: displayLabelConfigs,
    onSessionLabelsChange: handleSessionLabelsChange,
    enabledModes,
    sessionStatuses,
    onSessionSourcesChange: handleSessionSourcesChange,
    isCompactMode: isAutoCompact,
    onNewChat: handleNewChat,
  }), [contextValue, handleDeleteSession, handleNewChat, sources, skills, activeSessionWorkingDirectory, displayLabelConfigs, handleSessionLabelsChange, enabledModes, sessionStatuses, handleSessionSourcesChange, isAutoCompact])

  const handleTasksClick = useCallback(() => {
    navigate(routes.view.tasks())
  }, [])

  const handleInboxClick = useCallback(() => {
    navigate(routes.view.inbox())
  }, [])

  const handleAllSessionsClick = useCallback(() => {
    navigate(routes.view.allSessions())
  }, [])

  // Handlers for automations view
  const handleAutomationsClick = useCallback(() => {
    navigate(routes.view.automations())
  }, [])

  // Handler for projects view
  const handleProjectsClick = useCallback(() => {
    navigate(routes.view.projects())
  }, [])

  // Handler for library view
  const handleLibraryClick = useCallback(() => {
    navigate(routes.view.library())
  }, [])

  // Handler for settings view: Settings opens on General (it has no index).
  const handleSettingsClick = useCallback(() => {
    navigate(routes.view.settings())
  }, [])

  // Settings (its pages, Skills and Sources) has its own sidebar, whose Back to app returns to
  // the last view outside it (Chats when Settings was the first view opened).
  const inSettings = isSettingsNavigation(navState) || isSkillsNavigation(navState) || isSourcesNavigation(navState)
  const lastAppRouteRef = useRef<Route>(routes.view.allSessions())
  useEffect(() => {
    if (!inSettings) lastAppRouteRef.current = buildRouteFromNavigationState(navState) as Route
  }, [inSettings, navState])
  const handleBackToApp = useCallback(() => {
    navigate(lastAppRouteRef.current)
  }, [])

  // Respond to menu bar "New Chat" trigger
  const menuTriggerRef = useRef(menuNewChatTrigger)
  useEffect(() => {
    // Skip initial render
    if (menuTriggerRef.current === menuNewChatTrigger) return
    menuTriggerRef.current = menuNewChatTrigger
    handleNewChat()
  }, [menuNewChatTrigger, handleNewChat])

  // The area whose row is filled (none under Settings: it opens from the user menu).
  const sidebarArea: SidebarArea | null = isSessionsNavigation(navState)
    ? 'chats'
    : isTasksNavigation(navState)
      ? 'tasks'
      : isProjectsNavigation(navState)
        ? 'projects'
        : isAutomationsNavigation(navState)
          ? 'routines'
          : isLibraryNavigation(navState)
            ? 'library'
            : isInboxNavigation(navState)
              ? 'inbox'
              : null

  return (
    <AppShellProvider value={appShellContextValue}>
      <CommandPaletteProvider>
      <SidebarProvider>
        {/* Electron: the window's top 8px is drag space everywhere (the gutters, the sidebar header and the chat's pinned row are the rest). */}
        {!isWebUI && <div aria-hidden className="titlebar-drag-region fixed inset-x-0 top-0 z-50 h-2" />}
        <CloseSheetOnNavigate />
        <AppSidebar
          active={sidebarArea}
          onInbox={handleInboxClick}
          onTasks={handleTasksClick}
          onChats={handleAllSessionsClick}
          onProjects={handleProjectsClick}
          onRoutines={handleAutomationsClick}
          onLibrary={handleLibraryClick}
          onSettings={handleSettingsClick}
          settings={inSettings}
          onBackToApp={handleBackToApp}
          onBack={goBack}
          onForward={goForward}
          canGoBack={canGoBack}
          canGoForward={canGoForward}
          workspaces={workspaces}
          activeWorkspaceId={activeWorkspaceId}
          onSelectWorkspace={onSelectWorkspace}
          workspaceUnreadMap={workspaceUnreadMap}
          onWorkspaceCreated={() => onRefreshWorkspaces?.()}
          onWorkspaceRemoved={() => onRefreshWorkspaces?.()}
          sessionStatuses={sessionStatuses}
        />
        <SidecarProvider>
          <ComposerProvider>
            <PageFrame aside={<SidecarHost />} composer={<ShellComposer />}>
              <MainContentPanel />
            </PageFrame>
          </ComposerProvider>
        </SidecarProvider>
      </SidebarProvider>
      </CommandPaletteProvider>

      {/* Send to Workspace dialog (driven by sendToWorkspaceAtom) */}
      <SendToWorkspaceDialog
        open={sendToWorkspaceIds.length > 0}
        onOpenChange={(open) => { if (!open) setSendToWorkspaceIds([]) }}
        sessionIds={sendToWorkspaceIds}
        workspaces={workspaces}
        activeWorkspaceId={activeWorkspaceId}
        onTransferComplete={handleTransferComplete}
      />

      {/* Messaging dialogs (pairing-code + WA connect) — driven by messagingDialogAtom.
          Mounted here so they survive context-menu / dropdown close. */}
      <MessagingDialogHost />

    </AppShellProvider>
  )
}
