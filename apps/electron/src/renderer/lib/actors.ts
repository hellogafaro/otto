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
 * The members of a chat other than the viewer (its `members`, `user:<id>` and `agent:<id>`, creator first): the agents
 * first, then the people, never a duplicate. Until `me` is known nobody is listed: the viewer must never see
 * themselves, not even for a moment.
 */
export function otherMembers(members: readonly string[] | undefined, me: string | null): string[] {
  if (!me) return []
  const others = [...new Set(members ?? [])].filter((actor) => actor !== me)
  return [...others.filter(isAgentActor), ...others.filter((actor) => !isAgentActor(actor))]
}

/** A people chat (a DM or a group): no primary agent and no agent among its members, so sending runs nothing. */
export const isPeopleChat = (chat: { agentId?: string; members?: readonly string[] }) =>
  !chat.agentId && !(chat.members ?? []).some(isAgentActor)

/**
 * Whether sending `text` starts an agent run: an agent replies when mentioned (`agent:<id>` in the text), or, in a
 * chat with its primary agent and at most one person, to every message.
 */
export function startsAgentRun(chat: { agentId?: string; members?: readonly string[] }, text: string): boolean {
  if (/(^|\s)agent:[A-Za-z0-9._-]+/.test(text)) return true
  return !!chat.agentId && (chat.members ?? []).filter((actor) => !isAgentActor(actor)).length <= 1
}

/** The first `max` entries of an avatar group and how many more there are ("+N"). */
export function collapseGroup<T>(entries: readonly T[], max = 3): { shown: T[]; more: number } {
  return { shown: entries.slice(0, max), more: Math.max(0, entries.length - max) }
}
