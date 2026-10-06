/**
 * The two pure mappings between the app's route strings (`allSessions/session/abc`,
 * `settings/appearance`: the internal API, see `shared/routes.ts`) and its URLs
 * (`/{workspaceSlug}/chats/abc`, `/{workspaceSlug}/settings/appearance`). Nothing here touches
 * the router or the DOM, so every route kind is unit-tested as a round trip.
 *
 * The navigation state is the middle step on both sides, so a route string and a URL always mean
 * the same view: `routeString -> NavigationState -> URL` and back.
 *
 * | Route string                      | URL                                        |
 * | --------------------------------- | ------------------------------------------ |
 * | `allSessions[/session/id]`        | `/{ws}/chats[/id]`                         |
 * | `allSessions[/session/id]?status=a&status=b&label=c&flagged=1&archived=1` | `/{ws}/chats[/id]?status=a&status=b&label=c&flagged=1&archived=1` (the same query) |
 * | `view/{id}[/session/id]`          | `/{ws}/chats[/id]?view={id}`               |
 * | `settings[/page]`                 | `/{ws}/settings[/page]`                    |
 * | `projects[/project/id][?tab=&status=archived]` | `/{ws}/projects[/id][?tab=&status=archived]` (the same query) |
 * | `tasks[/task/id][?project=&assignee=&status=&archived=1]` | `/{ws}/tasks[/id]` with the same query |
 * | `automations[/{type}][/automation/id]` | `/{ws}/routines[/id][?type=]`         |
 * | `library[/item/id][?tab=&folder=&createdBy=]` | `/{ws}/library[/id]` with the same query |
 * | `skills[/skill/id]`               | `/{ws}/skills[/id]`                        |
 * | `sources[/{type}][/source/id]`    | `/{ws}/sources[/id][?type=]`               |
 *
 * The Chats filters combine and repeat (see `shared/chat-filters.ts`); the older single-value route
 * strings (`state/{id}`, `label/{id}`, `flagged`, `archived`) parse to them. Search is read and written as
 * plain query strings (repeated keys for lists), not TanStack's default JSON form.
 * The search of Tasks, Projects and Library is in `shared/section-search.ts`; an item keeps its index's search, so Back returns to it.
 */

import { isReservedWorkspaceSlug } from '@otto/shared/utils/workspace-slug'
import {
  chatFiltersFromSessionFilter,
  isTruthyFlag,
  normalizeChatFilters,
  sessionFilterFromChatFilters,
  type ChatFilters,
} from '../../shared/chat-filters'
import { buildRouteFromNavigationState, parseRouteToNavigationState } from '../../shared/route-parser'
import { isValidSettingsSubpage } from '../../shared/settings-registry'
import {
  normalizeLibrarySearch,
  normalizeProjectsSearch,
  normalizeTasksSearch,
  parseSearch,
  stringifySearch,
} from '../../shared/section-search'
import type { AutomationFilter, NavigationState, SessionFilter, SourceFilter } from '../../shared/types'

export type LocationSearch = Record<string, string | string[] | true>

export interface AppLocation {
  pathname: string
  search: LocationSearch
}

/** The Chats index filters, in the search of `/{ws}/chats[/id]`: statuses and labels (any number), flagged, archived; or one view. */
export interface ChatsSearch {
  status?: string[]
  label?: string[]
  view?: string
  flagged?: true
  archived?: true
}

/** The type filter of Sources (`api`, `mcp`, `local`) and Routines (`scheduled`, `event`, `agentic`). */
export interface TypeSearch {
  type?: string
}

const SOURCE_TYPES = ['api', 'mcp', 'local']
const AUTOMATION_TYPES = ['scheduled', 'event', 'agentic']

// Search is read and written as plain query strings (`?status=a&status=b&flagged=1`): see `shared/section-search.ts`
export { parseSearch, stringifySearch }

// =============================================================================
// Search validation (the route tree's `validateSearch`)
// =============================================================================

function text(value: unknown): string | undefined {
  if (typeof value === 'string') return value || undefined
  if (typeof value === 'number') return String(value)
  return undefined
}

function list(value: unknown): unknown[] {
  return Array.isArray(value) ? value : value === undefined ? [] : [value]
}

/** The Chats filters of a search, normalized: lists of distinct strings, `1`/`true` flags, unknown params dropped. A view applies only without filters. */
export function validateChatsSearch(search: Record<string, unknown>): ChatsSearch {
  const filters = normalizeChatFilters({
    status: list(search.status) as string[],
    label: list(search.label) as string[],
    flagged: isTruthyFlag(search.flagged),
    archived: isTruthyFlag(search.archived),
  })
  const out: ChatsSearch = {}
  if (filters.status.length > 0) out.status = filters.status
  if (filters.label.length > 0) out.label = filters.label
  if (filters.flagged) out.flagged = true
  if (filters.archived) out.archived = true
  const view = text(search.view)
  if (view && Object.keys(out).length === 0) out.view = view
  return out
}

export function validateSourcesSearch(search: Record<string, unknown>): TypeSearch {
  const type = text(search.type)
  return type && SOURCE_TYPES.includes(type) ? { type } : {}
}

export function validateRoutinesSearch(search: Record<string, unknown>): TypeSearch {
  const type = text(search.type)
  return type && AUTOMATION_TYPES.includes(type) ? { type } : {}
}

// =============================================================================
// Route string -> URL
// =============================================================================

const enc = encodeURIComponent

function chatsSearch(filter: SessionFilter, filters: ChatFilters): LocationSearch {
  if (filter.kind === 'view') return { view: filter.viewId }
  const search: LocationSearch = {}
  if (filters.status.length > 0) search.status = filters.status
  if (filters.label.length > 0) search.label = filters.label
  if (filters.flagged) search.flagged = true
  if (filters.archived) search.archived = true
  return search
}

function stateToLocation(state: NavigationState, ws: string): AppLocation {
  const base = `/${enc(ws)}`
  switch (state.navigator) {
    case 'sessions':
      return {
        pathname: `${base}/chats${state.details ? `/${enc(state.details.sessionId)}` : ''}`,
        search: chatsSearch(state.filter, state.filters ?? chatFiltersFromSessionFilter(state.filter)),
      }
    case 'settings':
      return { pathname: `${base}/settings${state.subpage ? `/${state.subpage}` : ''}`, search: {} }
    case 'sources':
      return {
        pathname: `${base}/sources${state.details ? `/${enc(state.details.sourceSlug)}` : ''}`,
        search: state.filter?.kind === 'type' ? { type: state.filter.sourceType } : {},
      }
    case 'skills':
      return { pathname: `${base}/skills${state.details ? `/${enc(state.details.skillSlug)}` : ''}`, search: {} }
    case 'automations':
      return {
        pathname: `${base}/routines${state.details ? `/${enc(state.details.automationId)}` : ''}`,
        search: state.filter?.kind === 'type' ? { type: state.filter.automationType } : {},
      }
    case 'projects':
      return { pathname: `${base}/projects${state.details ? `/${enc(state.details.projectId)}` : ''}`, search: state.search as LocationSearch }
    case 'tasks':
      return { pathname: `${base}/tasks${state.details ? `/${enc(state.details.taskId)}` : ''}`, search: state.search as LocationSearch }
    case 'library':
      return { pathname: `${base}/library${state.details ? `/${enc(state.details.itemId)}` : ''}`, search: state.search as LocationSearch }
  }
}

/** The URL of a view route string in a workspace; null for an action or an invalid route. */
export function routeStringToLocation(routeString: string, workspaceSlug: string): AppLocation | null {
  const state = parseRouteToNavigationState(routeString)
  return state ? stateToLocation(state, workspaceSlug) : null
}

// =============================================================================
// URL -> route string
// =============================================================================

function decode(segment: string): string {
  try {
    return decodeURIComponent(segment)
  } catch {
    return segment
  }
}

function segmentsOf(pathname: string): string[] {
  return pathname.split('/').filter(Boolean).map(decode)
}

/** The workspace slug (first segment) of a pathname; null for `/` and for a reserved first segment. */
export function workspaceSlugFromPathname(pathname: string): string | null {
  const [slug] = segmentsOf(pathname)
  return slug && !isReservedWorkspaceSlug(slug) ? slug : null
}

function chatsStateFromSearch(search: Record<string, unknown>, id: string | undefined): NavigationState {
  const { status, label, view, flagged, archived } = validateChatsSearch(search)
  const filters = normalizeChatFilters({ status, label, flagged, archived })
  return {
    navigator: 'sessions',
    filter: view ? { kind: 'view', viewId: view } : sessionFilterFromChatFilters(filters),
    filters,
    details: id ? { type: 'session', sessionId: id } : null,
  }
}

function stateFromLocation(section: string, id: string | undefined, search: Record<string, unknown>): NavigationState | null {
  switch (section) {
    case 'chats':
      return chatsStateFromSearch(search, id)
    case 'settings':
      if (id === undefined) return { navigator: 'settings', subpage: null }
      return isValidSettingsSubpage(id) ? { navigator: 'settings', subpage: id } : null
    case 'sources': {
      const type = validateSourcesSearch(search).type
      const filter: SourceFilter | undefined = type ? { kind: 'type', sourceType: type as 'api' | 'mcp' | 'local' } : undefined
      return { navigator: 'sources', filter, details: id ? { type: 'source', sourceSlug: id } : null }
    }
    case 'skills':
      return { navigator: 'skills', details: id ? { type: 'skill', skillSlug: id } : null }
    case 'routines': {
      const type = validateRoutinesSearch(search).type
      const filter: AutomationFilter | undefined = type
        ? { kind: 'type', automationType: type as 'scheduled' | 'event' | 'agentic' }
        : undefined
      return { navigator: 'automations', filter, details: id ? { type: 'automation', automationId: id } : null }
    }
    case 'projects':
      return { navigator: 'projects', search: normalizeProjectsSearch(search), details: id ? { type: 'project', projectId: id } : null }
    case 'tasks':
      return { navigator: 'tasks', search: normalizeTasksSearch(search), details: id ? { type: 'task', taskId: id } : null }
    case 'library':
      return { navigator: 'library', search: normalizeLibrarySearch(search), details: id ? { type: 'item', itemId: id } : null }
    default:
      return null
  }
}

/** The view route string and workspace slug of a URL; null when the URL is not one of the app's views. */
export function locationToRouteString(
  pathname: string,
  search: Record<string, unknown> = {},
): { routeString: string; workspaceSlug: string } | null {
  const workspaceSlug = workspaceSlugFromPathname(pathname)
  if (!workspaceSlug) return null
  const [, section, id, ...rest] = segmentsOf(pathname)
  if (!section || rest.length > 0) return null
  const state = stateFromLocation(section, id, search)
  return state ? { routeString: buildRouteFromNavigationState(state), workspaceSlug } : null
}

// =============================================================================
// Legacy URLs
// =============================================================================

/**
 * The path URL of a legacy one, or null when the URL is current. The query-string build kept the
 * view in `?ws=<slug>&route=<routeString>` (and `?workspaceId=` was a transitional extra); saved
 * window URLs and bookmarks may still carry them. Other params are kept.
 */
export function translateLegacyUrl(pathname: string, search: string): string | null {
  const params = new URLSearchParams(search)
  if (!['ws', 'route', 'workspaceId'].some((key) => params.has(key))) return null

  const ws = params.get('ws')
  const route = params.get('route')
  for (const key of ['ws', 'route', 'workspaceId']) params.delete(key)

  let target = pathname
  const isRoot = segmentsOf(pathname).length === 0
  if (isRoot && ws && route) {
    const location = routeStringToLocation(route, ws)
    if (location) {
      target = location.pathname
      for (const [key, value] of new URLSearchParams(stringifySearch(location.search))) params.append(key, value)
    }
  }
  const query = params.toString()
  return `${target}${query ? `?${query}` : ''}`
}
