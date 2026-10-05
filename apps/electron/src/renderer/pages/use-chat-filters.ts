/**
 * The Chats index's filters: Status and Label (several values each, any of them matches),
 * Flagged and Archived (on / off); fields combine (all must match).
 *
 * They live in the route, so Back from a chat returns to the same filters. One value is the
 * route-string filter (`state/<id>`, `label/<id>`, `flagged`, `archived`); anything more is
 * `allSessions` with a query part (`allSessions?status=todo&status=done&label=a&flagged=true`),
 * which the router round-trips to the URL's search params (`/chats?status=todo&status=done`).
 */

import { useCallback, useMemo } from 'react'
import { useAtomValue } from 'jotai'
import { matchesLabelFilter, type LabelConfig } from '@otto/shared/labels'
import { routes, type Route } from '@/lib/navigate'
import { currentRouteAtom } from '@/atoms/current-route'
import type { SessionMeta } from '@/atoms/sessions'
import { isSessionsNavigation, useNavigation, useNavigationState, type SessionFilter } from '@/contexts/navigation-context'
import { getSessionStatus } from '@/utils/session'

export interface ChatFilters {
  status: string[]
  label: string[]
  flagged: boolean
  archived: boolean
}

export const NO_CHAT_FILTERS: ChatFilters = { status: [], label: [], flagged: false, archived: false }

export function hasChatFilters(f: ChatFilters): boolean {
  return f.status.length > 0 || f.label.length > 0 || f.flagged || f.archived
}

function isOn(value: string | null): boolean {
  return value === 'true' || value === '1'
}

/** The filters of the open route: its query part when it has one, else its route-string filter. */
export function chatFiltersFromRoute(route: string | null, filter: SessionFilter): ChatFilters {
  const query = route?.split('?')[1]
  if (query) {
    const params = new URLSearchParams(query)
    const fromQuery: ChatFilters = {
      status: params.getAll('status'),
      label: params.getAll('label'),
      flagged: isOn(params.get('flagged')),
      archived: isOn(params.get('archived')),
    }
    if (hasChatFilters(fromQuery)) return fromQuery
  }
  switch (filter.kind) {
    case 'state': return { ...NO_CHAT_FILTERS, status: [filter.stateId] }
    case 'label': return { ...NO_CHAT_FILTERS, label: [filter.labelId] }
    case 'flagged': return { ...NO_CHAT_FILTERS, flagged: true }
    case 'archived': return { ...NO_CHAT_FILTERS, archived: true }
    default: return NO_CHAT_FILTERS
  }
}

/** The route string of a set of filters: the one-filter routes for one, a query part for more. */
export function chatFiltersRoute(f: ChatFilters): Route {
  const total = f.status.length + f.label.length + (f.flagged ? 1 : 0) + (f.archived ? 1 : 0)
  if (total === 0) return routes.view.allSessions()
  if (total === 1) {
    if (f.status[0]) return routes.view.state(f.status[0])
    if (f.label[0]) return routes.view.label(f.label[0])
    return f.flagged ? routes.view.flagged() : routes.view.archived()
  }
  const params = new URLSearchParams()
  for (const s of f.status) params.append('status', s)
  for (const l of f.label) params.append('label', l)
  if (f.flagged) params.set('flagged', 'true')
  if (f.archived) params.set('archived', 'true')
  // Not one of `routes.view`'s shapes yet: the query part is the router's contract for combined filters.
  return `${routes.view.allSessions()}?${params.toString()}` as Route
}

/** Whether a chat matches the filters, archived or not (the caller splits off Archived). */
export function matchesChatFilters(session: SessionMeta, f: ChatFilters, labels: LabelConfig[]): boolean {
  if (f.status.length > 0 && !f.status.includes(getSessionStatus(session))) return false
  if (f.label.length > 0 && !f.label.some((labelId) => matchesLabelFilter(session, { labelId }, labels))) return false
  if (f.flagged && !session.isFlagged) return false
  if (f.archived && !session.isArchived) return false
  return true
}

/** The open route's chat filters and a setter that navigates to the route of new ones. */
export function useChatFilters(): [ChatFilters, (next: ChatFilters) => void] {
  const { navigate } = useNavigation()
  const navState = useNavigationState()
  const route = useAtomValue(currentRouteAtom)
  const filter: SessionFilter = isSessionsNavigation(navState) ? navState.filter : { kind: 'allSessions' }
  const filters = useMemo(() => chatFiltersFromRoute(route, filter), [route, filter])
  const setFilters = useCallback((next: ChatFilters) => { void navigate(chatFiltersRoute(next)) }, [navigate])
  return [filters, setFilters]
}
