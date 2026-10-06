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
