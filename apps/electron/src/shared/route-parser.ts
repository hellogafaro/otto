/**
 * Route Parser
 *
 * Parses route strings back into structured navigation objects.
 * Used by both the navigate() function and deep link handler.
 *
 * Supports route formats:
 * - Action: action/{name}[/{id}] - Trigger side effects
 * - Compound: {filter}[/session/{sessionId}] - View routes for full navigation state
 */

import type {
  NavigationState,
  SessionFilter,
  SourceFilter,
  AutomationFilter,
} from './types'
import { DEFAULT_SETTINGS_SUBPAGE, isValidSettingsSubpage, type SettingsSubpage } from './settings-registry'
import {
  chatFiltersFromParams,
  chatFiltersFromSessionFilter,
  chatFiltersToQuery,
  normalizeChatFilters,
  sessionFilterFromChatFilters,
  type ChatFilters,
} from './chat-filters'
import {
  normalizeInboxSearch,
  normalizeLibrarySearch,
  normalizeProjectsSearch,
  normalizeSkillsSearch,
  normalizeTasksSearch,
  parseSearch,
  stringifySearch,
  type InboxSearch,
  type LibrarySearch,
  type ProjectsSearch,
  type SkillsSearch,
  type TasksSearch,
} from './section-search'

// =============================================================================
// Route Types
// =============================================================================

export type RouteType = 'action' | 'view'

export interface ParsedRoute {
  type: RouteType
  name: string
  id?: string
  params: Record<string, string>
}

// =============================================================================
// Compound Route Types (new format)
// =============================================================================

export type NavigatorType = 'sessions' | 'sources' | 'skills' | 'agents' | 'automations' | 'projects' | 'library' | 'tasks' | 'inbox' | 'settings'

export interface ParsedCompoundRoute {
  /** The navigator type */
  navigator: NavigatorType
  /** Session filter (only for sessions navigator): the first of `sessionFilters`*/
  sessionFilter?: SessionFilter
  /** The combined Chats filters (only for sessions navigator; see chat-filters.ts) */
  sessionFilters?: ChatFilters
  /** Source filter (only for sources navigator) */
  sourceFilter?: SourceFilter
  /** Automation filter (only for automations navigator) */
  automationFilter?: AutomationFilter
  /** The search of the tasks, projects, library, skills and inbox views (see section-search.ts) */
  search?: TasksSearch | ProjectsSearch | LibrarySearch | SkillsSearch | InboxSearch
  /** Details page info (null for empty state) */
  details: {
    type: string
    id: string
  } | null
}

// =============================================================================
// Compound Route Parsing
// =============================================================================

/**
 * Known prefixes that indicate a compound route
 */
const COMPOUND_ROUTE_PREFIXES = [
  'allSessions', 'flagged', 'archived', 'state', 'label', 'sources', 'skills', 'agents', 'automations', 'projects', 'library', 'tasks', 'inbox', 'settings'
]

/** The detail segment and the search of the sections that have them. */
const SECTION_SEARCH = {
  tasks: { detail: 'task', normalize: normalizeTasksSearch },
  projects: { detail: 'project', normalize: normalizeProjectsSearch },
  library: { detail: 'item', normalize: normalizeLibrarySearch },
  skills: { detail: 'skill', normalize: normalizeSkillsSearch },
} as const

/**
 * Check if a route is a compound route (new format)
 */
export function isCompoundRoute(route: string): boolean {
  const firstSegment = route.split('?')[0].split('/')[0]
  return COMPOUND_ROUTE_PREFIXES.includes(firstSegment)
}

/**
 * Parse a compound route into structured navigation
 *
 * Examples:
 *   'allSessions' -> { navigator: 'sessions', sessionFilter: { kind: 'allSessions' }, details: null }
 *   'allSessions/session/abc123' -> { navigator: 'sessions', sessionFilter: { kind: 'allSessions' }, details: { type: 'session', id: 'abc123' } }
 *   'allSessions?status=todo&status=done&label=a' -> the filters combined, in `sessionFilters`
 *   'flagged/session/abc123' -> the same as 'allSessions/session/abc123?flagged=1' (the older single-value forms
 *     `state/<id>`, `label/<id>`, `flagged`, `archived` become filters)
 *   'sources' -> { navigator: 'sources', details: null }
 *   'sources/api' -> { navigator: 'sources', sourceFilter: { kind: 'type', sourceType: 'api' }, details: null }
 *   'sources/mcp' -> { navigator: 'sources', sourceFilter: { kind: 'type', sourceType: 'mcp' }, details: null }
 *   'sources/local' -> { navigator: 'sources', sourceFilter: { kind: 'type', sourceType: 'local' }, details: null }
 *   'sources/source/github' -> { navigator: 'sources', details: { type: 'source', id: 'github' } }
 *   'sources/api/source/gmail' -> { navigator: 'sources', sourceFilter: { kind: 'type', sourceType: 'api' }, details: { type: 'source', id: 'gmail' } }
 *   'settings' -> { navigator: 'settings', details: { type: 'app', id: 'app' } }  // no index: General
 *   'settings/shortcuts' -> { navigator: 'settings', details: { type: 'shortcuts', id: 'shortcuts' } }
 */
export function parseCompoundRoute(route: string): ParsedCompoundRoute | null {
  // Compound routes are pure slash-segment paths; defensively strip any query tail
  // so a stray `?x=y` never leaks into segment parsing (e.g. into a labelId).
  const [pathPart, queryPart] = route.split('?')
  const segments = pathPart.split('/').filter(Boolean)
  if (segments.length === 0) return null

  const first = segments[0]

  // Settings: a page; Settings has no index, so the bare `settings` (an older route string) is General
  if (first === 'settings') {
    const subpage = segments[1] ?? DEFAULT_SETTINGS_SUBPAGE
    if (!isValidSettingsSubpage(subpage)) return null
    return {
      navigator: 'settings',
      details: { type: subpage, id: subpage },
    }
  }

  // Sources navigator - supports type filters (api, mcp, local)
  if (first === 'sources') {
    if (segments.length === 1) {
      return { navigator: 'sources', details: null }
    }

    // Check for type filter: sources/api, sources/mcp, sources/local
    const validSourceTypes = ['api', 'mcp', 'local']
    if (validSourceTypes.includes(segments[1])) {
      const sourceType = segments[1] as 'api' | 'mcp' | 'local'
      const sourceFilter: SourceFilter = { kind: 'type', sourceType }

      // Check for source selection within filtered view: sources/api/source/{sourceSlug}
      if (segments[2] === 'source' && segments[3]) {
        return {
          navigator: 'sources',
          sourceFilter,
          details: { type: 'source', id: segments[3] },
        }
      }

      // Just the filter, no selection
      return { navigator: 'sources', sourceFilter, details: null }
    }

    // Unfiltered source selection: sources/source/{sourceSlug}
    if (segments[1] === 'source' && segments[2]) {
      return {
        navigator: 'sources',
        details: { type: 'source', id: segments[2] },
      }
    }

    return null
  }

  // Tasks, Projects, Library and Skills: the index or one item (`tasks/task/{id}`, `projects/project/{id}`,
  // `library/item/{id}`, `skills/skill/{slug}`), each with its search in the query
  if (first === 'tasks' || first === 'projects' || first === 'library' || first === 'skills') {
    const { detail, normalize } = SECTION_SEARCH[first]
    const search = normalize(parseSearch(queryPart ?? ''))
    if (segments.length === 1) return { navigator: first, search, details: null }
    if (segments.length === 3 && segments[1] === detail) return { navigator: first, search, details: { type: detail, id: segments[2] } }
    return null
  }

  // Agents: the gallery or one agent (`agents/agent/{id}`); no search
  if (first === 'agents') {
    if (segments.length === 1) return { navigator: 'agents', details: null }
    if (segments.length === 3 && segments[1] === 'agent') return { navigator: 'agents', details: { type: 'agent', id: segments[2] } }
    return null
  }

  // Inbox: one page, `inbox?unread=1`
  if (first === 'inbox') {
    return segments.length === 1 ? { navigator: 'inbox', search: normalizeInboxSearch(parseSearch(queryPart ?? '')), details: null } : null
  }

  // Automations navigator - supports type filters (scheduled, event, agentic)
  if (first === 'automations') {
    if (segments.length === 1) {
      return { navigator: 'automations', details: null }
    }

    // Check for type filter: automations/scheduled, automations/event, automations/agentic
    const validAutomationTypes = ['scheduled', 'event', 'agentic']
    if (validAutomationTypes.includes(segments[1])) {
      const automationType = segments[1] as 'scheduled' | 'event' | 'agentic'
      const automationFilter: AutomationFilter = { kind: 'type', automationType }

      // Check for automation selection within filtered view: automations/scheduled/automation/{automationId}
      if (segments[2] === 'automation' && segments[3]) {
        return {
          navigator: 'automations',
          automationFilter,
          details: { type: 'automation', id: segments[3] },
        }
      }

      // Just the filter, no selection
      return { navigator: 'automations', automationFilter, details: null }
    }

    // Unfiltered automation selection: automations/automation/{automationId}
    if (segments[1] === 'automation' && segments[2]) {
      return {
        navigator: 'automations',
        details: { type: 'automation', id: segments[2] },
      }
    }

    return null
  }

  // Sessions navigator: the Chats index with its filters (`?status=..&label=..&flagged=1`)
  const fromQuery = chatFiltersFromParams(new URLSearchParams(queryPart ?? ''))
  const filters = { status: [...fromQuery.status], label: [...fromQuery.label], flagged: fromQuery.flagged, archived: fromQuery.archived }
  let detailsStartIndex = 1

  switch (first) {
    case 'allSessions':
      // The older single-filter forms, also after allSessions: allSessions/state/<id>, /label/<id>, /flagged, /archived
      while (detailsStartIndex < segments.length) {
        const kind = segments[detailsStartIndex]
        const value = segments[detailsStartIndex + 1]
        if ((kind === 'state' || kind === 'label') && value) {
          filters[kind === 'state' ? 'status' : 'label'].unshift(kind === 'state' ? value : decodeURIComponent(value))
          detailsStartIndex += 2
        } else if (kind === 'flagged' || kind === 'archived') {
          filters[kind] = true
          detailsStartIndex += 1
        } else {
          break
        }
      }
      break
    case 'flagged':
      filters.flagged = true
      break
    case 'archived':
      filters.archived = true
      break
    case 'state':
      if (!segments[1]) return null
      filters.status.unshift(segments[1])
      detailsStartIndex = 2
      break
    case 'label':
      if (!segments[1]) return null
      // Label IDs are URL-decoded (simple slugs, no special characters expected)
      filters.label.unshift(decodeURIComponent(segments[1]))
      detailsStartIndex = 2
      break
    default:
      return null
  }

  const sessionFilters = normalizeChatFilters(filters)
  const sessionFilter = sessionFilterFromChatFilters(sessionFilters)

  // Check for details
  if (segments.length > detailsStartIndex) {
    const detailsType = segments[detailsStartIndex]
    const detailsId = segments[detailsStartIndex + 1]
    if (detailsType === 'session' && detailsId) {
      return {
        navigator: 'sessions',
        sessionFilter,
        sessionFilters,
        details: { type: 'session', id: detailsId },
      }
    }
  }

  return {
    navigator: 'sessions',
    sessionFilter,
    sessionFilters,
    details: null,
  }
}

/**
 * Build a compound route string from parsed state
 */
export function buildCompoundRoute(parsed: ParsedCompoundRoute): string {
  if (parsed.navigator === 'settings') return `settings/${parsed.details?.type ?? DEFAULT_SETTINGS_SUBPAGE}`

  if (parsed.navigator === 'sources') {
    // Build base from filter (sources, sources/api, sources/mcp, sources/local)
    let base = 'sources'
    if (parsed.sourceFilter?.kind === 'type') {
      base = `sources/${parsed.sourceFilter.sourceType}`
    }
    if (!parsed.details) return base
    return `${base}/source/${parsed.details.id}`
  }

  if (parsed.navigator === 'automations') {
    // Build base from filter (automations, automations/scheduled, automations/event, automations/agentic)
    let base = 'automations'
    if (parsed.automationFilter?.kind === 'type') {
      base = `automations/${parsed.automationFilter.automationType}`
    }
    if (!parsed.details) return base
    return `${base}/automation/${parsed.details.id}`
  }

  if (parsed.navigator === 'inbox') return `inbox${stringifySearch(parsed.search ?? {})}`

  if (parsed.navigator === 'agents') return parsed.details ? `agents/agent/${parsed.details.id}` : 'agents'

  if (parsed.navigator === 'tasks' || parsed.navigator === 'projects' || parsed.navigator === 'library' || parsed.navigator === 'skills') {
    const base = parsed.details ? `${parsed.navigator}/${parsed.details.type}/${parsed.details.id}` : parsed.navigator
    return `${base}${stringifySearch(parsed.search ?? {})}`
  }

  // Sessions navigator: `allSessions[/session/<id>][?status=..&label=..&flagged=1&archived=1]`
  const filter = parsed.sessionFilter
  const session = parsed.details ? `/session/${parsed.details.id}` : ''
  const filters = parsed.sessionFilters ?? chatFiltersFromSessionFilter(filter)
  return `allSessions${session}${chatFiltersToQuery(filters)}`
}

// =============================================================================
// Route Parsing
// =============================================================================

/**
 * Parse a route string into structured navigation
 *
 * Examples:
 *   'allSessions' -> { type: 'view', name: 'allSessions', params: {} }
 *   'allSessions/session/abc123' -> { type: 'view', name: 'session', id: 'abc123', params: { filter: 'allSessions' } }
 *   'settings/shortcuts' -> { type: 'view', name: 'shortcuts', params: {} }
 *   'action/new-session' -> { type: 'action', name: 'new-session', params: {} }
 */
export function parseRoute(route: string): ParsedRoute | null {
  try {
    // Check if this is a compound route (preferred format)
    if (isCompoundRoute(route)) {
      const compound = parseCompoundRoute(route)
      if (compound) return { type: 'view', name: compound.navigator, params: {} }
    }

    // Parse action routes: action/{name}[/{id}]
    const [pathPart, queryPart] = route.split('?')
    const segments = pathPart.split('/').filter(Boolean)

    if (segments.length < 2) {
      return null
    }

    const type = segments[0]
    if (type !== 'action') {
      return null
    }

    const name = segments[1]
    const id = segments[2]

    // Parse query params
    const params: Record<string, string> = {}
    if (queryPart) {
      const searchParams = new URLSearchParams(queryPart)
      searchParams.forEach((value, key) => {
        params[key] = value
      })
    }

    return { type: 'action', name, id, params }
  } catch {
    return null
  }
}

// =============================================================================
// NavigationState Parsing (new unified system)
// =============================================================================

/**
 * Parse a route string directly to NavigationState (the unified state)
 *
 * This is the preferred way to parse routes - returns the unified state that
 * determines all 3 panels (sidebar, navigator, main content).
 *
 * Supports:
 * - Compound routes: allSessions, allSessions/session/abc, sources, sources/source/github, settings/shortcuts
 *
 * Returns null for action routes (they don't map to a navigation state) and invalid routes.
 */
export function parseRouteToNavigationState(route: string): NavigationState | null {
  if (!isCompoundRoute(route)) return null
  const compound = parseCompoundRoute(route)
  return compound ? convertCompoundToNavigationState(compound) : null
}

/**
 * Convert a ParsedCompoundRoute to NavigationState
 */
function convertCompoundToNavigationState(compound: ParsedCompoundRoute): NavigationState {
  // Settings
  if (compound.navigator === 'settings') {
    return { navigator: 'settings', subpage: (compound.details?.type as SettingsSubpage | undefined) ?? DEFAULT_SETTINGS_SUBPAGE }
  }

  // Sources - include filter if present
  if (compound.navigator === 'sources') {
    if (!compound.details) {
      return {
        navigator: 'sources',
        filter: compound.sourceFilter,
        details: null,
      }
    }
    return {
      navigator: 'sources',
      filter: compound.sourceFilter,
      details: { type: 'source', sourceSlug: compound.details.id },
    }
  }

  // Skills
  if (compound.navigator === 'skills') {
    return {
      navigator: 'skills',
      search: compound.search as SkillsSearch,
      details: compound.details ? { type: 'skill', skillSlug: compound.details.id } : null,
    }
  }

  if (compound.navigator === 'agents') {
    return { navigator: 'agents', details: compound.details ? { type: 'agent', agentId: compound.details.id } : null }
  }

  // Automations - include filter if present
  if (compound.navigator === 'automations') {
    if (!compound.details) {
      return {
        navigator: 'automations',
        filter: compound.automationFilter,
        details: null,
      }
    }
    return {
      navigator: 'automations',
      filter: compound.automationFilter,
      details: { type: 'automation', automationId: compound.details.id },
    }
  }

  // Tasks, Projects and Library
  if (compound.navigator === 'tasks') {
    return {
      navigator: 'tasks',
      search: compound.search as TasksSearch,
      details: compound.details ? { type: 'task', taskId: compound.details.id } : null,
    }
  }
  if (compound.navigator === 'projects') {
    return {
      navigator: 'projects',
      search: compound.search as ProjectsSearch,
      details: compound.details ? { type: 'project', projectId: compound.details.id } : null,
    }
  }
  if (compound.navigator === 'library') {
    return {
      navigator: 'library',
      search: compound.search as LibrarySearch,
      details: compound.details ? { type: 'item', itemId: compound.details.id } : null,
    }
  }

  if (compound.navigator === 'inbox') return { navigator: 'inbox', search: compound.search as InboxSearch }

  // Sessions
  const filter = compound.sessionFilter || { kind: 'allSessions' as const }
  const filters = compound.sessionFilters ?? chatFiltersFromSessionFilter(filter)
  if (compound.details) {
    return {
      navigator: 'sessions',
      filter,
      filters,
      details: { type: 'session', sessionId: compound.details.id },
    }
  }
  return {
    navigator: 'sessions',
    filter,
    filters,
    details: null,
  }
}

/**
 * Convert NavigationState to ParsedCompoundRoute
 */
function navigationStateToCompoundRoute(state: NavigationState): ParsedCompoundRoute {
  if (state.navigator === 'settings') {
    return {
      navigator: 'settings',
      details: { type: state.subpage, id: state.subpage },
    }
  }

  if (state.navigator === 'sources') {
    return {
      navigator: 'sources',
      sourceFilter: state.filter ?? undefined,
      details: state.details ? { type: 'source', id: state.details.sourceSlug } : null,
    }
  }

  if (state.navigator === 'skills') {
    return { navigator: 'skills', search: state.search, details: state.details ? { type: 'skill', id: state.details.skillSlug } : null }
  }

  if (state.navigator === 'agents') {
    return { navigator: 'agents', details: state.details ? { type: 'agent', id: state.details.agentId } : null }
  }

  if (state.navigator === 'automations') {
    return {
      navigator: 'automations',
      automationFilter: state.filter ?? undefined,
      details: state.details ? { type: 'automation', id: state.details.automationId } : null,
    }
  }

  if (state.navigator === 'tasks') {
    return { navigator: 'tasks', search: state.search, details: state.details ? { type: 'task', id: state.details.taskId } : null }
  }
  if (state.navigator === 'projects') {
    return { navigator: 'projects', search: state.search, details: state.details ? { type: 'project', id: state.details.projectId } : null }
  }
  if (state.navigator === 'library') {
    return { navigator: 'library', search: state.search, details: state.details ? { type: 'item', id: state.details.itemId } : null }
  }
  if (state.navigator === 'inbox') return { navigator: 'inbox', search: state.search, details: null }

  // Sessions
  return {
    navigator: 'sessions',
    sessionFilter: state.filter,
    sessionFilters: state.filters,
    details: state.details ? { type: 'session', id: state.details.sessionId } : null,
  }
}

/**
 * Build a route string from NavigationState
 */
export function buildRouteFromNavigationState(state: NavigationState): string {
  return buildCompoundRoute(navigationStateToCompoundRoute(state))
}
