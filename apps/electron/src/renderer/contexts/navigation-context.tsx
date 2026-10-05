/**
 * NavigationContext
 *
 * Provides a global `navigate()` function that decouples components from
 * direct session/action imports. All navigation goes through typed routes.
 *
 * ROUTE STRINGS ARE THE INTERNAL API, URLS ARE REAL PATHS:
 * `navigate('allSessions/session/abc')` opens `/{workspaceSlug}/chats/abc`. TanStack Router
 * (`../router`) owns the URL and the browser history; `router/location.ts` maps route strings
 * to URLs and back. The open route string is derived from the router's location (and mirrored
 * to `currentRouteAtom` for the atoms that read it), and the NavigationState (sidebar section,
 * page card content, header) is parsed from it.
 *
 * HISTORY:
 * Back / Forward are the router history's (the Electron buttons, the shortcuts, the browser);
 * the page header's Back is a different thing: the parent view.
 *
 * WORKSPACE:
 * The URL's first segment is the workspace slug. A known slug that is not the active
 * workspace switches to it (a back step, a pasted link); the switcher changing the active
 * workspace moves the URL to the new workspace; an unknown slug, `/` or an unmappable URL is
 * replaced with the active workspace's Chats.
 *
 * Usage:
 *   import { useNavigation, useNavigationState } from '@/contexts/navigation-context'
 *   import { routes } from '@/shared/routes'
 *
 *   const { navigate } = useNavigation()
 *   const navState = useNavigationState()
 *
 *   navigate(routes.view.allSessions())
 *   navigate(routes.action.newChat())
 */

import {
  createContext,
  useContext,
  useCallback,
  useEffect,
  useLayoutEffect,
  useRef,
  useState,
  useMemo,
  type ReactNode,
} from 'react'
import { useRouter, useRouterState } from '@tanstack/react-router'
import { useTranslation } from 'react-i18next'
import { toast } from 'sonner'
import { useAtomValue, useSetAtom, useStore } from 'jotai'
import { useSession } from '@/hooks/use-session'
import {
  parseRoute,
  parseRouteToNavigationState,
  buildRouteFromNavigationState,
  type ParsedRoute,
} from '../../shared/route-parser'
import { routes, type Route, type ViewRoute } from '../../shared/routes'
import { SETTINGS_NAV_ORDER } from '../../shared/menu-schema'
import type { SettingsSubpage } from '../../shared/settings-registry'
import { parsePermissionMode } from '@otto/shared/agent/mode-types'
import { NAVIGATE_EVENT } from '../lib/navigate'
import { chatFiltersFromSessionFilter } from '../../shared/chat-filters'
import {
  canGoBack as positionCanGoBack,
  canGoForward as positionCanGoForward,
  initialHistoryPosition,
  nextHistoryPosition,
} from '../router/history-position'
import { locationToRouteString, parseSearch, routeStringToLocation, workspaceSlugFromPathname } from '../router/location'
import type {
  DeepLinkNavigation,
  Session,
  NavigationState,
  SessionFilter,
  SourceFilter,
  ContentBadge,
} from '../../shared/types'
import {
  isSessionsNavigation,
  isSourcesNavigation,
  isSettingsNavigation,
  isSkillsNavigation,
  isAutomationsNavigation,
  isProjectsNavigation,
  isPagesNavigation,
  isTasksNavigation,
  DEFAULT_NAVIGATION_STATE,
} from '../../shared/types'
import { sessionMetaMapAtom, updateSessionMetaAtom } from '@/atoms/sessions'
import { sourcesAtom } from '@/atoms/sources'
import { skillsAtom } from '@/atoms/skills'
import { sessionListOrderAtom } from '@/atoms/list-context'
import { guardedModeAvailableAtom } from '@/atoms/permission-modes'
import { currentRouteAtom, parseSessionIdFromRoute } from '@/atoms/current-route'


// Re-export routes for convenience
export { routes }
export type { Route }

// Re-export navigation state types for consumers
export type { NavigationState, SessionFilter }
export { isSessionsNavigation, isSourcesNavigation, isSettingsNavigation, isSkillsNavigation, isAutomationsNavigation, isProjectsNavigation, isPagesNavigation, isTasksNavigation }

// =============================================================================
// Context
// =============================================================================

export interface NavigateOptions {
  /** Replace the open history entry instead of adding one (a redirect, not a step). */
  replace?: boolean
}

interface NavigationContextValue {
  /** Navigate to a route */
  navigate: (route: Route, opts?: NavigateOptions) => void | Promise<void>
  /** Check if navigation is ready */
  isReady: boolean
  /** Unified navigation state — parsed from the open route */
  navigationState: NavigationState
  /** Whether we can go back in history */
  canGoBack: boolean
  /** Whether we can go forward in history */
  canGoForward: boolean
  /** Go back in history */
  goBack: () => void
  /** Go forward in history */
  goForward: () => void
  /** Navigate to a source (or source list if no slug), preserving the current filter type */
  navigateToSource: (sourceSlug?: string) => void
  /** Navigate to a session, preserving the current filter type */
  navigateToSession: (sessionId: string) => void
  /**
   * Previous / next item in the list the open page came from (the Chats list or the
   * settings pages, as the sidebar shows them), or null when the open page has no list.
   */
  listNav: ListNavigation | null
}

export interface ListNavigation {
  hasPrev: boolean
  hasNext: boolean
  goPrev: () => void
  goNext: () => void
}

export const NavigationContext = createContext<NavigationContextValue | null>(null)

interface NavigationProviderProps {
  children: ReactNode
  /** Current workspace ID */
  workspaceId: string | null
  /** The active workspace's slug (the URL's first segment), null until the workspace is known */
  workspaceSlug: string | null
  /** Switch to a workspace by slug (the URL names a workspace other than the active one). False when there is none. */
  onSwitchWorkspaceBySlug?: (slug: string) => boolean
  /** Session creation handler */
  onCreateSession: (workspaceId: string, options?: import('../../shared/types').CreateSessionOptions) => Promise<Session>
  /** Input change handler for pre-filling chat input */
  onInputChange?: (sessionId: string, value: string) => void
  /** Get draft input text for a session (reads from ref, no re-render) */
  getDraft?: (sessionId: string) => string
  /** Auto-delete an empty session (no confirmation needed) */
  onAutoDeleteEmptySession?: (sessionId: string) => void
  /** Whether the app is ready to navigate */
  isReady?: boolean
  /** Whether session metadata has been initialized (the workspace and its sessions are known) */
  isSessionsReady?: boolean
  /** Remote workspace ID — when set, sessions with this ID are also considered part of the workspace */
  remoteWorkspaceId?: string | null
}

/**
 * The view a workspace switch lands on: the same settings page, otherwise the section's index
 * (the old workspace's chat, filter and detail do not exist in the new one).
 */
function workspaceSwitchRoute(state: NavigationState): string {
  switch (state.navigator) {
    case 'settings':
      return buildRouteFromNavigationState(state)
    case 'sessions':
      return routes.view.allSessions()
    default:
      return buildRouteFromNavigationState({ navigator: state.navigator, details: null })
  }
}

export function NavigationProvider({
  children,
  workspaceId,
  workspaceSlug,
  onSwitchWorkspaceBySlug,
  onCreateSession,
  onInputChange,
  getDraft,
  onAutoDeleteEmptySession,
  isReady = true,
  isSessionsReady = true,
  remoteWorkspaceId,
}: NavigationProviderProps) {
  const { t } = useTranslation()
  const [, setSession] = useSession()
  const router = useRouter()

  const updateSessionMeta = useSetAtom(updateSessionMetaAtom)

  // Store reference for reading fresh atom values in callbacks (avoids stale closures)
  const store = useStore()

  // Read sources from atom (populated by AppShell)
  const sources = useAtomValue(sourcesAtom)

  // Read skills from atom (populated by AppShell)
  const skills = useAtomValue(skillsAtom)

  // =========================================================================
  // DERIVED NAVIGATION STATE (from the router's location)
  // =========================================================================

  const location = useRouterState({ select: (s) => s.location })

  // The open view's route string, and the workspace slug the URL names. A URL that is not one of
  // the app's views has no route (the effect below replaces it).
  const currentRoute = useMemo(
    () => locationToRouteString(location.pathname, location.search)?.routeString ?? null,
    [location],
  )
  const urlSlug = workspaceSlugFromPathname(location.pathname)

  // NavigationState derived from the open route
  const navigationState: NavigationState = useMemo(() => {
    return currentRoute
      ? parseRouteToNavigationState(currentRoute) ?? DEFAULT_NAVIGATION_STATE
      : DEFAULT_NAVIGATION_STATE
  }, [currentRoute])

  // Mirror the route into the atom the pins, recents and session atoms read (before paint)
  useLayoutEffect(() => {
    store.set(currentRouteAtom, currentRoute as ViewRoute | null)
  }, [store, currentRoute])

  // =========================================================================
  // HISTORY (the router's: Back, Forward and what they can reach)
  // =========================================================================

  const [historyPosition, setHistoryPosition] = useState(() =>
    initialHistoryPosition(router.history.location.state.__TSR_index),
  )

  useEffect(
    () =>
      router.history.subscribe(({ location: next, action }) => {
        setHistoryPosition((prev) => nextHistoryPosition(prev, action.type, next.state.__TSR_index))
      }),
    [router],
  )

  const canGoBack = positionCanGoBack(historyPosition)
  const canGoForward = positionCanGoForward(historyPosition)

  const goBack = useCallback(() => {
    router.history.back()
  }, [router])

  const goForward = useCallback(() => {
    router.history.forward()
  }, [router])


  // =========================================================================
  // EMPTY SESSION CLEANUP (reactive — covers navigate, close tab, etc.)
  // =========================================================================

  // When the open session changes (navigate away), check whether the one left was
  // empty and auto-delete it. This is the single codepath for all navigate-away cleanup.
  const prevSessionIdRef = useRef<string | null>(null)

  useEffect(() => {
    const sessionId = currentRoute ? parseSessionIdFromRoute(currentRoute) : null
    const prevId = prevSessionIdRef.current

    // Only check after we've seen a session (skip first render to avoid false
    // positives during initialization)
    if (onAutoDeleteEmptySession && prevId && prevId !== sessionId) {
      const meta = store.get(sessionMetaMapAtom).get(prevId)
      const isEmpty = meta && !meta.lastFinalMessageId && !meta.name && !meta.isProcessing
      const hasDraft = getDraft?.(prevId)?.trim()
      if (isEmpty && !hasDraft) {
        onAutoDeleteEmptySession(prevId)
      }
    }

    prevSessionIdRef.current = sessionId
  }, [currentRoute, onAutoDeleteEmptySession, store, getDraft])

  // =========================================================================
  // SESSION SELECTION SYNC
  // =========================================================================

  // Keep the global session selection in sync with the open view
  useEffect(() => {
    if (isSessionsNavigation(navigationState) && navigationState.details) {
      setSession({ selected: navigationState.details.sessionId })
    }
  }, [navigationState, workspaceId, setSession])

  // =========================================================================
  // HELPERS
  // =========================================================================

  const getFirstSourceSlug = useCallback(
    (filter?: SourceFilter | null): string | null => {
      if (!filter) {
        return sources[0]?.config.slug ?? null
      }
      const filtered = sources.filter(s => s.config.type === filter.sourceType)
      return filtered[0]?.config.slug ?? null
    },
    [sources]
  )

  const getFirstSkillSlug = useCallback(
    (): string | null => {
      return skills[0]?.slug ?? null
    },
    [skills]
  )

  // =========================================================================
  // AUTO-SELECTION (pure computation, no side effects)
  // =========================================================================

  /**
   * Resolve auto-selection for a NavigationState. A chat is never auto-selected (the
   * Chats route is its index); Sources and Skills, which have no index yet, open their
   * first item. A chat that no longer exists falls back to the index. Returns the
   * final state (no side effects).
   */
  const resolveAutoSelection = useCallback(
    (newState: NavigationState): NavigationState => {
      let nextState = newState

      // Validate session exists in current workspace (local or remote ID)
      if (isSessionsNavigation(nextState) && nextState.details) {
        const freshMetaMap = store.get(sessionMetaMapAtom)
        const meta = freshMetaMap.get(nextState.details.sessionId)
        const matchesWorkspace = !workspaceId
          || meta?.workspaceId === workspaceId
          || (remoteWorkspaceId && meta?.workspaceId === remoteWorkspaceId)
        if (!meta || !matchesWorkspace) {
          nextState = { ...nextState, details: null }
        }
      }

      // Sources: auto-select first source
      if (isSourcesNavigation(nextState) && !nextState.details) {
        const firstSourceSlug = getFirstSourceSlug(nextState.filter)
        if (firstSourceSlug) {
          return { ...nextState, details: { type: 'source', sourceSlug: firstSourceSlug } }
        }
        return nextState
      }

      // Skills: auto-select first skill
      if (isSkillsNavigation(nextState) && !nextState.details) {
        const firstSkillSlug = getFirstSkillSlug()
        if (firstSkillSlug) {
          return { ...nextState, details: { type: 'skill', skillSlug: firstSkillSlug } }
        }
        return nextState
      }

      return nextState
    },
    [store, workspaceId, remoteWorkspaceId, getFirstSourceSlug, getFirstSkillSlug]
  )

  // =========================================================================
  // OPEN A ROUTE (route string -> URL -> router)
  // =========================================================================

  /**
   * Open a view route in a workspace: push the URL (replace it for a redirect). False when the route
   * has no URL. Nothing happens when that is already the open view.
   */
  const openRouteIn = useCallback(
    (route: string, slug: string, opts?: NavigateOptions): boolean => {
      const next = routeStringToLocation(route, slug)
      if (!next) return false
      // The history knows a push before the router's state does, so read the history
      const { pathname, search } = router.history.location
      const open = locationToRouteString(pathname, parseSearch(search))
      if (open?.routeString === route && open.workspaceSlug === slug) return true
      void router.navigate({ to: next.pathname, search: next.search, replace: opts?.replace })
      return true
    },
    [router],
  )

  /** Open a view route in the workspace the URL names (the active one when it names none). */
  const openRoute = useCallback(
    (route: string, opts?: NavigateOptions): boolean => {
      const slug = workspaceSlugFromPathname(router.history.location.pathname) ?? workspaceSlug
      return slug ? openRouteIn(route, slug, opts) : false
    },
    [router, workspaceSlug, openRouteIn],
  )

  // Sources and Skills have no index yet: opening their list root (a URL typed or restored, or
  // before the lists loaded) opens the first item, as navigate() does.
  useEffect(() => {
    if (!isReady || (workspaceSlug && urlSlug !== workspaceSlug)) return
    if (!(isSourcesNavigation(navigationState) || isSkillsNavigation(navigationState)) || navigationState.details) return
    const resolved = resolveAutoSelection(navigationState)
    if (resolved !== navigationState) openRoute(buildRouteFromNavigationState(resolved), { replace: true })
  }, [isReady, workspaceSlug, urlSlug, navigationState, resolveAutoSelection, openRoute])

  // =========================================================================
  // ACTION NAVIGATION
  // =========================================================================

  const handleActionNavigation = useCallback(
    async (parsed: ParsedRoute) => {
      if (!workspaceId) return

      switch (parsed.name) {
        case 'new-session': {
          const createOptions: import('../../shared/types').CreateSessionOptions = {}
          if (parsed.params.mode) {
            const parsedMode = parsePermissionMode(parsed.params.mode)
            if (parsedMode) {
              createOptions.permissionMode = parsedMode
            }
          }
          if (parsed.params.workdir) {
            createOptions.workingDirectory = parsed.params.workdir as 'user_default' | 'none' | string
          }
          if (parsed.params.model) {
            createOptions.model = parsed.params.model
          }
          if (parsed.params.systemPrompt) {
            createOptions.systemPromptPreset = parsed.params.systemPrompt as 'default' | 'mini' | string
          }
          if (parsed.params.status) {
            createOptions.sessionStatus = parsed.params.status
          }
          if (parsed.params.label) {
            createOptions.labels = [parsed.params.label]
          }
          if (parsed.params.project) {
            createOptions.projectId = parsed.params.project
          }
          const session = await onCreateSession(workspaceId, createOptions)

          if (parsed.params.name) {
            await window.electronAPI.sessionCommand(session.id, { type: 'rename', name: parsed.params.name })
          }

          if (parsed.params.status) {
            updateSessionMeta(session.id, { sessionStatus: parsed.params.status })
          }
          if (parsed.params.label) {
            updateSessionMeta(session.id, { labels: [parsed.params.label] })
          }

          if (parsed.params.status) {
            await window.electronAPI.sessionCommand(session.id, { type: 'setSessionStatus', state: parsed.params.status })
          }
          if (parsed.params.label) {
            await window.electronAPI.sessionCommand(session.id, { type: 'setLabels', labels: [parsed.params.label] })
          }

          // Determine navigation filter
          const filter: import('../../shared/types').SessionFilter =
            parsed.params.status ? { kind: 'state', stateId: parsed.params.status } :
            parsed.params.label ? { kind: 'label', labelId: parsed.params.label } :
            { kind: 'allSessions' }

          // Open the new session (the session selection syncs in an effect)
          const newState: NavigationState = {
            navigator: 'sessions',
            filter,
            details: { type: 'session', sessionId: session.id },
          }
          openRoute(buildRouteFromNavigationState(newState))

          // Parse badges from params
          let badges: ContentBadge[] | undefined
          if (parsed.params.badges) {
            try {
              badges = JSON.parse(parsed.params.badges) as ContentBadge[]
            } catch (e) {
              console.warn('[Navigation] Failed to parse badges param:', e)
            }
          }

          // Handle input: either auto-send or pre-fill
          if (parsed.params.input) {
            const shouldSend = parsed.params.send === 'true'
            if (shouldSend) {
              setTimeout(() => {
                window.electronAPI.sendMessage(
                  session.id,
                  parsed.params.input!,
                  undefined,
                  undefined,
                  badges ? { badges } : undefined
                )
              }, 100)
            } else if (onInputChange) {
              setTimeout(() => {
                onInputChange(session.id, parsed.params.input!)
              }, 100)
            }
          }
          break
        }

        case 'rename-session':
          if (parsed.id && parsed.params.name) {
            await window.electronAPI.sessionCommand(parsed.id, { type: 'rename', name: parsed.params.name })
          }
          break

        case 'delete-session':
          if (parsed.id) {
            await window.electronAPI.deleteSession(parsed.id)
          }
          break

        case 'flag-session':
          if (parsed.id) {
            await window.electronAPI.sessionCommand(parsed.id, { type: 'flag' })
          }
          break

        case 'unflag-session':
          if (parsed.id) {
            await window.electronAPI.sessionCommand(parsed.id, { type: 'unflag' })
          }
          break

        case 'oauth':
          if (parsed.id) {
            await window.electronAPI.performOAuth({ sourceSlug: parsed.id })
          }
          break

        case 'delete-source':
          if (parsed.id) {
            await window.electronAPI.deleteSource(workspaceId, parsed.id)
          }
          break

        case 'set-mode':
          if (parsed.id && parsed.params.mode) {
            const parsedMode = parsePermissionMode(parsed.params.mode)
            if (!parsedMode) {
              console.warn('[Navigation] Invalid permission mode:', parsed.params.mode)
              break
            }
            if (parsedMode === 'guarded' && !store.get(guardedModeAvailableAtom)) {
              console.warn('[Navigation] Guarded mode is not available (turn it on under Settings → AI → Decision model)')
              break
            }
            await window.electronAPI.sessionCommand(
              parsed.id,
              { type: 'setPermissionMode', mode: parsedMode }
            )
          }
          break

        case 'copy':
          if (parsed.params.text) {
            await navigator.clipboard.writeText(parsed.params.text)
          }
          break

        default:
          console.warn('[Navigation] Unknown action:', parsed.name)
      }
    },
    [workspaceId, onCreateSession, onInputChange, openRoute, updateSessionMeta]
  )

  // =========================================================================
  // NAVIGATE
  // =========================================================================

  // A navigation that cannot run yet (the app is not ready, or the workspace slug is not known):
  // the last one waits.
  const pendingNavigationRef = useRef<{ route: Route; opts?: NavigateOptions } | null>(null)

  const navigate = useCallback(
    async (route: Route, opts?: NavigateOptions) => {
      const parsed = parseRoute(route)
      if (!parsed) {
        console.warn('[Navigation] Invalid route:', route)
        return
      }

      if (!isReady) {
        pendingNavigationRef.current = { route, opts }
        return
      }

      // Handle actions (side effects)
      if (parsed.type === 'action') {
        await handleActionNavigation(parsed)
        return
      }

      // Parse route to NavigationState. Bare `settings` produces `subpage: null`:
      // the Settings index. It never redirects to a subpage.
      const newNavState = parseRouteToNavigationState(route)

      if (newNavState) {
        // Resolve auto-selection (pure — no side effects), then open its URL
        const finalRoute = buildRouteFromNavigationState(resolveAutoSelection(newNavState))
        if (!openRoute(finalRoute, opts)) pendingNavigationRef.current = { route, opts }
      }
    },
    [isReady, handleActionNavigation, resolveAutoSelection, openRoute]
  )

  useEffect(() => {
    const pending = pendingNavigationRef.current
    if (!pending || !isReady || !(urlSlug ?? workspaceSlug)) return
    pendingNavigationRef.current = null
    void navigate(pending.route, pending.opts)
  }, [isReady, urlSlug, workspaceSlug, navigate])

  // =========================================================================
  // WORKSPACE (the URL's first segment and the active workspace agree)
  // =========================================================================

  const workspaceSyncRef = useRef<{ url: string | null; active: string | null }>({ url: null, active: null })
  const requestedSwitchRef = useRef<string | null>(null)
  const onSwitchWorkspaceBySlugRef = useRef(onSwitchWorkspaceBySlug)
  useEffect(() => { onSwitchWorkspaceBySlugRef.current = onSwitchWorkspaceBySlug }, [onSwitchWorkspaceBySlug])

  useEffect(() => {
    if (!isReady || !isSessionsReady || !workspaceId || !workspaceSlug) return
    const prev = workspaceSyncRef.current
    workspaceSyncRef.current = { url: urlSlug, active: workspaceSlug }

    if (urlSlug === workspaceSlug) {
      requestedSwitchRef.current = null
      // The workspace is right but the URL is no view of the app (an unknown section, a bad settings page)
      if (!currentRoute) openRouteIn(routes.view.allSessions(), workspaceSlug, { replace: true })
      return
    }

    // The active workspace changed (the switcher): the URL follows
    if (prev.active !== null && prev.active !== workspaceSlug && prev.url === urlSlug) {
      openRouteIn(workspaceSwitchRoute(navigationState), workspaceSlug)
      return
    }

    // The URL names another workspace (a back step, a pasted link, a restored window): switch to it
    if (urlSlug) {
      if (requestedSwitchRef.current === urlSlug) return
      if (onSwitchWorkspaceBySlugRef.current?.(urlSlug)) {
        requestedSwitchRef.current = urlSlug
        return
      }
    }

    // The URL names no workspace (`/`, an unknown slug): this one's Chats
    requestedSwitchRef.current = null
    openRouteIn(routes.view.allSessions(), workspaceSlug, { replace: true })
  }, [isReady, isSessionsReady, workspaceId, workspaceSlug, urlSlug, currentRoute, navigationState, openRouteIn])

  // =========================================================================
  // DEEP LINK LISTENER
  // =========================================================================

  useEffect(() => {
    if (!workspaceId) return

    const cleanup = window.electronAPI.onDeepLinkNavigate((nav: DeepLinkNavigation) => {
      let route: string | null = null

      if (nav.view) {
        route = nav.view
      } else if (nav.action) {
        route = `action/${nav.action}`
        if (nav.actionParams?.id) {
          route += `/${nav.actionParams.id}`
        }
        const otherParams = { ...nav.actionParams }
        delete otherParams.id
        if (Object.keys(otherParams).length > 0) {
          const params = new URLSearchParams(otherParams)
          route += `?${params.toString()}`
        }
      }

      if (route) {
        const navState = parseRouteToNavigationState(route)
        if (!navState && !route.startsWith('action/')) {
          toast.error(t('toast.invalidLink'), {
            description: t('toast.invalidLinkDesc'),
          })
          return
        }
        navigate(route as Route)
      }
    })

    return cleanup
  }, [workspaceId, navigate])

  // =========================================================================
  // INTERNAL NAVIGATION EVENT LISTENER
  // =========================================================================

  useEffect(() => {
    const handleNavigateEvent = (event: Event) => {
      const customEvent = event as CustomEvent<{ route: Route }>
      if (customEvent.detail?.route) navigate(customEvent.detail.route)
    }

    window.addEventListener(NAVIGATE_EVENT, handleNavigateEvent)
    return () => {
      window.removeEventListener(NAVIGATE_EVENT, handleNavigateEvent)
    }
  }, [navigate])

  // =========================================================================
  // PRESERVE-FILTER NAVIGATION HELPERS
  // =========================================================================

  const navigateToSource = useCallback((sourceSlug?: string) => {
    if (isSourcesNavigation(navigationState) && navigationState.filter?.kind === 'type') {
      switch (navigationState.filter.sourceType) {
        case 'api':
          navigate(routes.view.sourcesApi(sourceSlug))
          return
        case 'mcp':
          navigate(routes.view.sourcesMcp(sourceSlug))
          return
        case 'local':
          navigate(routes.view.sourcesLocal(sourceSlug))
          return
      }
    }
    navigate(routes.view.sources(sourceSlug ? { sourceSlug } : undefined))
  }, [navigationState, navigate])

  const navigateToSession = useCallback((sessionId: string) => {
    if (!isSessionsNavigation(navigationState)) {
      navigate(routes.view.allSessions(sessionId))
      return
    }

    // The chat opens under the filters the index was showing
    const { filter, filters } = navigationState
    if (filter.kind === 'view') {
      navigate(routes.view.view(filter.viewId, sessionId))
    } else {
      navigate(routes.view.allSessions(sessionId, filters ?? chatFiltersFromSessionFilter(filter)))
    }
  }, [navigationState, navigate])

  // =========================================================================
  // LIST NAVIGATION (previous / next in the index the page was opened from)
  // =========================================================================

  const sessionListOrder = useAtomValue(sessionListOrderAtom)
  const listNav = useMemo<ListNavigation | null>(() => {
    // The list the open page is an item of: the Chats index's table as it shows it, or
    // the settings pages in the Settings index's order (a fixed list).
    let order: readonly string[] = []
    let current: string | null = null
    let open: (id: string) => void = () => {}
    if (isSessionsNavigation(navigationState) && navigationState.details) {
      order = sessionListOrder
      current = navigationState.details.sessionId
      open = navigateToSession
    } else if (isSettingsNavigation(navigationState)) {
      order = SETTINGS_NAV_ORDER
      current = navigationState.subpage
      open = (id) => navigate(routes.view.settings(id as SettingsSubpage))
    }
    const index = current === null ? -1 : order.indexOf(current)
    if (index === -1) return null
    return {
      hasPrev: index > 0,
      hasNext: index < order.length - 1,
      goPrev: () => { if (index > 0) open(order[index - 1]) },
      goNext: () => { if (index < order.length - 1) open(order[index + 1]) },
    }
  }, [navigationState, sessionListOrder, navigateToSession, navigate])

  // =========================================================================
  // CONTEXT VALUE
  // =========================================================================

  return (
    <NavigationContext.Provider
      value={{
        navigate,
        isReady,
        navigationState,
        canGoBack,
        canGoForward,
        goBack,
        goForward,
        navigateToSource,
        navigateToSession,
        listNav,
      }}
    >
      {children}
    </NavigationContext.Provider>
  )
}

/**
 * Hook to access navigation functions
 */
export function useNavigation() {
  const context = useContext(NavigationContext)
  if (!context) {
    throw new Error('useNavigation must be used within NavigationProvider')
  }
  return context
}

/**
 * Hook to access just the navigation state
 */
export function useNavigationState(): NavigationState {
  const { navigationState } = useNavigation()
  return navigationState
}