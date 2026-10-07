/** A window of `text` around the first query word it contains, about `max` characters, newlines flattened. */
export function snippetOf(text: string, query: string, max = 150): string {
  const flat = text.replace(/\s+/g, ' ').trim()
  const lower = flat.toLowerCase()
  const at = query
    .toLowerCase()
    .split(/\s+/)
    .filter(Boolean)
    .map((word) => lower.indexOf(word))
    .filter((index) => index >= 0)
    .sort((a, b) => a - b)[0] ?? 0
  const start = Math.max(0, at - Math.floor(max / 2))
  const end = Math.min(flat.length, start + max)
  return `${start > 0 ? '...' : ''}${flat.slice(start, end)}${end < flat.length ? '...' : ''}`
}
