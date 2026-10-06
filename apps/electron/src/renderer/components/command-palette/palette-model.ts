/**
 * The command palette's logic, pure: which entries match a query and in what order,
 * how they group, and which category tabs exist. The component only draws the result.
 *
 * Matching is local and instant (no network): a name containing the query wins,
 * ranked by where it matches (the start, then a word's start, then anywhere); then
 * the query's words in any order, then the initials ("ns" finds "New session").
 * Accents and case never matter.
 */

export const PALETTE_CATEGORIES = ['all', 'chats', 'tasks', 'projects', 'library', 'pages', 'settings', 'skills', 'sources', 'actions'] as const
export type PaletteCategory = (typeof PALETTE_CATEGORIES)[number]
/** A category with entries of its own (every one but All). */
export type PaletteSection = Exclude<PaletteCategory, 'all'>
/** A group of rows: a section, or Pinned and Recent at the top of All. */
export type PaletteGroupKey = 'pinned' | 'recent' | PaletteSection

/** The rows of All's groups (each tab lists its own in full). */
export const GROUP_LIMIT = 5
/** The longest query looked at. */
export const MAX_QUERY = 200

export interface PaletteEntry {
  /** Unique within its group; a chat is `chat:<id>` everywhere, so All can leave out what Pinned or Recent show. */
  key: string
  title: string
  /** Other words that find it (a settings page's group, an action's synonyms). */
  keywords?: readonly string[]
}

export type PaletteData<T extends PaletteEntry> = Record<PaletteSection, readonly T[]> & {
  pinned: readonly T[]
  recent: readonly T[]
}

export interface PaletteGroup<T extends PaletteEntry> {
  key: PaletteGroupKey
  items: T[]
}

const SECTIONS = PALETTE_CATEGORIES.filter((c): c is PaletteSection => c !== 'all')

/** Lowercase, without accents, one space between words. */
export function normalize(text: string): string {
  return text
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .replace(/\s+/g, ' ')
    .trim()
}

/** The query as matched: trimmed, capped, normalized. */
export function cleanQuery(query: string): string {
  return normalize(query.slice(0, MAX_QUERY))
}

const words = (text: string) => text.split(/[^\p{L}\p{N}]+/u).filter(Boolean)

/**
 * How well `text` matches a normalized query: 5 it starts with it, 4 a word starts
 * with it, 3 it contains it, 2 it contains every word of it, 1 its initials start
 * with it, 0 no match. An empty query matches everything (1).
 */
export function matchRank(text: string, query: string): number {
  if (!query) return 1
  const value = normalize(text)
  const index = value.indexOf(query)
  if (index === 0) return 5
  if (index > 0) return /[^\p{L}\p{N}]/u.test(value[index - 1]!) ? 4 : 3
  const parts = query.split(' ')
  if (parts.length > 1 && parts.every((part) => value.includes(part))) return 2
  const compact = query.replace(/ /g, '')
  if (compact.length >= 2 && words(value).map((w) => w[0]).join('').startsWith(compact)) return 1
  return 0
}

/** The best rank of the title and the keywords (a keyword match never beats a title's start). */
export function entryRank(entry: PaletteEntry, query: string): number {
  const title = matchRank(entry.title, query)
  if (!query || title >= 3 || !entry.keywords?.length) return title
  const keyword = Math.max(0, ...entry.keywords.map((k) => Math.min(matchRank(k, query), 3)))
  return Math.max(title, keyword)
}

/** The entries that match, best first; equal ones keep their order (chats stay newest first). */
export function filterEntries<T extends PaletteEntry>(entries: readonly T[], query: string): T[] {
  if (!query) return [...entries]
  return entries
    .map((entry, index) => ({ entry, index, rank: entryRank(entry, query) }))
    .filter((m) => m.rank > 0)
    .sort((a, b) => b.rank - a.rank || a.index - b.index)
    .map((m) => m.entry)
}

/** All and every section that has something: an empty one gets no tab. */
export function availableCategories<T extends PaletteEntry>(data: PaletteData<T>): PaletteCategory[] {
  return ['all', ...SECTIONS.filter((section) => data[section].length > 0)]
}

/** The category to show: the one asked for, or All when it has nothing. */
export function resolveCategory(available: readonly PaletteCategory[], wanted: PaletteCategory): PaletteCategory {
  return available.includes(wanted) ? wanted : 'all'
}

/** Tab and Shift+Tab: the next or previous tab, wrapping around. */
export function stepCategory(available: readonly PaletteCategory[], current: PaletteCategory, step: 1 | -1): PaletteCategory {
  if (available.length === 0) return 'all'
  const index = Math.max(0, available.indexOf(current))
  return available[(index + step + available.length) % available.length]!
}

/**
 * The groups to draw. A tab lists its section's matches in full. All lists every
 * section's best `GROUP_LIMIT`, in tab order; with no query it opens with Pinned and
 * Recent (`GROUP_LIMIT` of them), and the Chats group leaves out the chats they show.
 * Empty groups are left out.
 */
export function buildGroups<T extends PaletteEntry>(
  data: PaletteData<T>,
  category: PaletteCategory,
  query: string,
): PaletteGroup<T>[] {
  if (category !== 'all') return keep([{ key: category, items: filterEntries(data[category], query) }])

  const top: PaletteGroup<T>[] = query
    ? []
    : [
        { key: 'pinned', items: [...data.pinned] },
        { key: 'recent', items: data.recent.slice(0, GROUP_LIMIT) },
      ]
  const shown = new Set(top.flatMap((group) => group.items.map((item) => item.key)))
  const sections = SECTIONS.map((section): PaletteGroup<T> => ({
    key: section,
    items: filterEntries(data[section], query)
      .filter((item) => !shown.has(item.key))
      .slice(0, GROUP_LIMIT),
  }))
  return keep([...top, ...sections])
}

/** Whether a query finds anything in any section (no tabs are drawn when it does not). */
export function hasAnyMatch<T extends PaletteEntry>(data: PaletteData<T>, query: string): boolean {
  return SECTIONS.some((section) => data[section].some((entry) => entryRank(entry, query) > 0))
}

/**
 * What the results follow while the field is debounced: the debounced query, and
 * whether it is still catching up with the typed one (the rows are then skeletons).
 * An empty field is never debounced: clearing it shows the defaults at once.
 */
export function paletteView(query: string, debouncedQuery: string): { query: string; pending: boolean } {
  if (!query) return { query: '', pending: false }
  return { query: debouncedQuery, pending: query !== debouncedQuery }
}

/** The cmdk value of a row: unique across groups, since a chat can sit in Pinned and Chats. */
export function rowValue(group: PaletteGroupKey, entry: Pick<PaletteEntry, 'key'>): string {
  return `${group}/${entry.key}`
}

function keep<T extends PaletteEntry>(groups: PaletteGroup<T>[]): PaletteGroup<T>[] {
  return groups.filter((group) => group.items.length > 0)
}
