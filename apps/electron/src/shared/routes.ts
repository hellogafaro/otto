/**
 * Route Registry
 *
 * Type-safe route definitions for navigation throughout the app.
 * All navigation should use these route builders instead of hardcoded strings.
 *
 * Route Formats:
 * - action/{name}[/{id}] - Trigger side effects
 * - {filter}[/session/{sessionId}] - Compound view routes for full navigation state
 *
 * Usage:
 *   import { routes } from '@/shared/routes'
 *   navigate(routes.action.newSession())
 *   navigate(routes.view.allSessions())
 *   navigate(routes.view.settings('shortcuts'))
 */

import { DEFAULT_SETTINGS_SUBPAGE, type SettingsSubpage } from './settings-registry'
import type { PermissionMode } from '@otto/shared/agent/mode-types'
import { chatFiltersToQuery, normalizeChatFilters, type ChatFiltersInput } from './chat-filters'
import { stringifySearch, type InboxSearch, type LibrarySearch, type ProjectsSearch, type SkillsSearch, type TasksSearch } from './section-search'

// Helper to build query strings from params
function toQueryString(params?: Record<string, string | undefined>): string {
  if (!params) return ''
  const filtered = Object.entries(params).filter(([, v]) => v !== undefined)
  if (filtered.length === 0) return ''
  const searchParams = new URLSearchParams(
    filtered as [string, string][]
  )
  return `?${searchParams.toString()}`
}

/** `tasks`, `tasks/task/<id>`, with the search as a query: `tasks?project=p1&status=todo`. */
function sectionRoute<S extends string>(section: S, detail: string, id: string | undefined, search: Record<string, unknown>): `${S}${string}` {
  return `${section}${id ? `/${detail}/${id}` : ''}${stringifySearch(search)}`
}

export type AllSessionsRoute = `allSessions${string}`

/** `allSessions`, `allSessions/session/<id>`, `allSessions?<filters>`, `allSessions/session/<id>?<filters>`. */
function allSessionsRoute(filters?: ChatFiltersInput): AllSessionsRoute
function allSessionsRoute(sessionId?: string, filters?: ChatFiltersInput): AllSessionsRoute
function allSessionsRoute(first?: string | ChatFiltersInput, second?: ChatFiltersInput): AllSessionsRoute {
  const sessionId = typeof first === 'string' ? first : undefined
  const filters = normalizeChatFilters(typeof first === 'string' ? second : first)
  return `allSessions${sessionId ? `/session/${sessionId}` : ''}${chatFiltersToQuery(filters)}`
}

/**
 * Route definitions with type-safe builders
 */
export const routes = {
  // ============================================
  // Action Routes - Trigger actions
  // ============================================
  action: {
    /**
     * Create a new session
     * @param input - Optional initial message to pre-fill or send
     * @param name - Optional session name
     * @param send - If true and input is provided, immediately sends the message
     * @param status - Optional status/todo-state ID to apply to the new session
     * @param label - Optional label ID to apply to the new session
     * @param project - Optional project id to bind the new session to
     */
    newSession: (params?: { input?: string; name?: string; send?: boolean; status?: string; label?: string; project?: string }) =>
      `action/new-session${toQueryString(params ? { ...params, send: params.send ? 'true' : undefined } : undefined)}` as const,

    /** Rename a session */
    renameSession: (sessionId: string, name: string) =>
      `action/rename-session/${sessionId}?name=${encodeURIComponent(name)}` as const,

    /** Delete a session (with confirmation) */
    deleteSession: (sessionId: string) =>
      `action/delete-session/${sessionId}` as const,

    /** Toggle flag on a session */
    flagSession: (sessionId: string) =>
      `action/flag-session/${sessionId}` as const,

    /** Unflag a session */
    unflagSession: (sessionId: string) =>
      `action/unflag-session/${sessionId}` as const,

    /** Start OAuth flow for a source */
    oauth: (sourceSlug: string) => `action/oauth/${sourceSlug}` as const,

    /** Open add source UI */
    addSource: () => 'action/add-source' as const,

    // Note: test-source route can be added when API support is available
    // testSource: (sourceSlug: string) => `action/test-source/${sourceSlug}` as const,

    /** Delete a source */
    deleteSource: (sourceSlug: string) =>
      `action/delete-source/${sourceSlug}` as const,

    /** Set permission mode for a session */
    setPermissionMode: (
      sessionId: string,
      mode: PermissionMode
    ) => `action/set-mode/${sessionId}?mode=${mode}` as const,

    /** Copy text to clipboard */
    copyToClipboard: (text: string) =>
      `action/copy?text=${encodeURIComponent(text)}` as const,
  },

  // ============================================
  // View Routes - Compound sidebar/navigator/details routes
  // ============================================
  view: {
    /**
     * The Chats index (sessions navigator), optionally with a chat open and/or filters (statuses and
     * labels, any number, with flagged and archived, combined): `allSessions?status=todo&status=done&label=a`.
     */
    allSessions: allSessionsRoute,

    /** Flagged view (sessions navigator, flagged filter) */
    flagged: (sessionId?: string) =>
      sessionId ? `flagged/session/${sessionId}` as const : 'flagged' as const,

    /** Archived view (sessions navigator, archived filter) */
    archived: (sessionId?: string) =>
      sessionId ? `archived/session/${sessionId}` as const : 'archived' as const,

    /** Todo state filter view (sessions navigator, state filter) */
    state: (stateId: string, sessionId?: string) =>
      sessionId
        ? `state/${stateId}/session/${sessionId}` as const
        : `state/${stateId}` as const,

    /** Label filter view (sessions navigator, label filter — includes descendants via tree hierarchy) */
    label: (labelId: string, sessionId?: string) =>
      sessionId
        ? `label/${encodeURIComponent(labelId)}/session/${sessionId}` as const
        : `label/${encodeURIComponent(labelId)}` as const,

    /** Sources view (sources navigator): the grid on a `type`, or `sourceSlug` open (keeping the type for Back). */
    sources: (params?: { sourceSlug?: string; type?: 'api' | 'mcp' | 'local' }) => {
      const { sourceSlug, type } = params ?? {}
      // Build base from filter type
      const base = type ? `sources/${type}` : 'sources'
      if (sourceSlug) {
        return `${base}/source/${sourceSlug}` as const
      }
      return base as 'sources' | `sources/${'api' | 'mcp' | 'local'}`
    },

    /** Skills view (skills navigator): the grid with its `scope`, or `skillSlug` open. */
    skills: ({ skillSlug, ...search }: { skillSlug?: string } & SkillsSearch = {}) => sectionRoute('skills', 'skill', skillSlug, search),

    /** Automations view (automations navigator) - supports type filtering */
    automations: (params?: { automationId?: string; type?: 'scheduled' | 'event' | 'agentic' }) => {
      const { automationId, type } = params ?? {}
      const base = type ? `automations/${type}` : 'automations'
      if (automationId) return `${base}/automation/${automationId}` as const
      return base as 'automations' | `automations/${'scheduled' | 'event' | 'agentic'}`
    },

    /** A settings page; Settings has no index, so no page means General (the registry's first). */
    settings: (subpage: SettingsSubpage = DEFAULT_SETTINGS_SUBPAGE) => `settings/${subpage}` as const,

    /** Projects view (projects navigator): the index (`status: 'archived'`), or `projectId` open on a `tab`. */
    projects: ({ projectId, ...search }: { projectId?: string } & ProjectsSearch = {}) =>
      sectionRoute('projects', 'project', projectId, search),

    /** Tasks view (tasks navigator): the index with its filters, or `taskId` open. */
    tasks: ({ taskId, ...search }: { taskId?: string } & TasksSearch = {}) => sectionRoute('tasks', 'task', taskId, search),

    /** Library view (library navigator): the grid on a `tab` and `folder`, or the file or document `itemId` open. */
    library: ({ itemId, ...search }: { itemId?: string } & LibrarySearch = {}) => sectionRoute('library', 'item', itemId, search),

    /** Inbox: your notifications, `unread` keeps the unread ones. */
    inbox: (search: InboxSearch = {}) => `inbox${stringifySearch(search)}` as const,
  },
} as const

/**
 * Type representing any valid route string
 */
export type ActionRoute = ReturnType<(typeof routes.action)[keyof typeof routes.action]>
export type ViewRoute = ReturnType<(typeof routes.view)[keyof typeof routes.view]>
export type Route = ActionRoute | ViewRoute
