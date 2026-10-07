/** Pure helpers on actor strings (`user:<id>`, `agent:<id>`; see `@otto/shared/actors`) for the people UI. */

export const isAgentActor = (actor: string) => actor.startsWith('agent:')

/** FNV-1a: a small, stable hash, so an actor keeps its color across reloads and devices. */
export function actorColorIndex(actor: string, count: number): number {
  let hash = 0x811c9dc5
  for (let i = 0; i < actor.length; i++) hash = Math.imul(hash ^ actor.charCodeAt(i), 0x01000193)
  return (hash >>> 0) % count
}

/** Up to two capital letters: the first letters of the first and last word (`Ada Lovelace` is `AL`). Empty for no letters. */
export function initialsOf(name: string): string {
  const words = name.trim().split(/\s+/).filter(Boolean)
  const letters = [words[0], words.length > 1 ? words[words.length - 1] : undefined]
    .map((word) => (word ? Array.from(word)[0] : ''))
    .join('')
  return letters.toUpperCase()
}

/**
 * The people of a chat other than the viewer: its `participants` (`user:<id>`, creator first) without `me`, never a
 * duplicate. Until `me` is known nobody is listed: the viewer must never see themselves, not even for a moment.
 */
export function otherParticipants(participants: readonly string[] | undefined, me: string | null): string[] {
  if (!me) return []
  return [...new Set(participants ?? [])].filter((actor) => actor !== me && !isAgentActor(actor))
}

/** The first `max` entries of an avatar group and how many more there are ("+N"). */
export function collapseGroup<T>(entries: readonly T[], max = 3): { shown: T[]; more: number } {
  return { shown: entries.slice(0, max), more: Math.max(0, entries.length - max) }
}
