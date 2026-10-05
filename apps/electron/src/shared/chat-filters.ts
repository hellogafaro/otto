/**
 * The Chats index filters: statuses and labels (any number of each), flagged and archived, all
 * at once. They live in the route string's query (`allSessions?status=todo&status=done&label=a&flagged=1`)
 * and in the URL's search, in the same form, so one value round-trips between the two.
 *
 * The older single-value route strings (`state/<id>`, `label/<id>`, `flagged`, `archived`) still parse;
 * they become one of these filters.
 */

import type { SessionFilter } from './types'

export interface ChatFilters {
  status: string[]
  label: string[]
  flagged: boolean
  archived: boolean
}

export type ChatFiltersInput = Partial<ChatFilters>

export const EMPTY_CHAT_FILTERS: ChatFilters = { status: [], label: [], flagged: false, archived: false }

function uniqueText(values: readonly unknown[] | undefined): string[] {
  const out: string[] = []
  for (const value of values ?? []) {
    const text = typeof value === 'number' ? String(value) : value
    if (typeof text === 'string' && text !== '' && !out.includes(text)) out.push(text)
  }
  return out
}

/** Arrays of distinct non-empty strings and booleans, whatever was given. */
export function normalizeChatFilters(input?: ChatFiltersInput | null): ChatFilters {
  return {
    status: uniqueText(input?.status),
    label: uniqueText(input?.label),
    flagged: input?.flagged === true,
    archived: input?.archived === true,
  }
}

export function hasChatFilters(filters: ChatFilters): boolean {
  return filters.status.length > 0 || filters.label.length > 0 || filters.flagged || filters.archived
}

/** Query params in a fixed order (statuses, labels, flagged, archived), so equal filters are equal strings. */
export function chatFiltersToParams(filters: ChatFilters): URLSearchParams {
  const params = new URLSearchParams()
  for (const status of filters.status) params.append('status', status)
  for (const label of filters.label) params.append('label', label)
  if (filters.flagged) params.set('flagged', '1')
  if (filters.archived) params.set('archived', '1')
  return params
}

/** `''` for no filter, else `?status=todo&label=a`. */
export function chatFiltersToQuery(filters: ChatFilters): string {
  const query = chatFiltersToParams(filters).toString()
  return query ? `?${query}` : ''
}

export function isTruthyFlag(value: unknown): boolean {
  return value === true || value === 1 || value === '1' || value === 'true'
}

export function chatFiltersFromParams(params: URLSearchParams): ChatFilters {
  return normalizeChatFilters({
    status: params.getAll('status'),
    label: params.getAll('label'),
    flagged: isTruthyFlag(params.get('flagged')),
    archived: isTruthyFlag(params.get('archived')),
  })
}

/** The filters of a single-filter value (the older `SessionFilter`); a view filter has none. */
export function chatFiltersFromSessionFilter(filter: SessionFilter | undefined): ChatFilters {
  switch (filter?.kind) {
    case 'state': return normalizeChatFilters({ status: [filter.stateId] })
    case 'label': return normalizeChatFilters({ label: [filter.labelId] })
    case 'flagged': return normalizeChatFilters({ flagged: true })
    case 'archived': return normalizeChatFilters({ archived: true })
    default: return EMPTY_CHAT_FILTERS
  }
}

/** The single filter older consumers read: the first of status, label, flagged, archived. */
export function sessionFilterFromChatFilters(filters: ChatFilters): SessionFilter {
  if (filters.status.length > 0) return { kind: 'state', stateId: filters.status[0] }
  if (filters.label.length > 0) return { kind: 'label', labelId: filters.label[0] }
  if (filters.flagged) return { kind: 'flagged' }
  if (filters.archived) return { kind: 'archived' }
  return { kind: 'allSessions' }
}
