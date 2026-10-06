/**
 * The `@` mention picker's text logic, pure: where an `@query` is being typed, who matches it, and the text with
 * the person's token (`user:<id>`, what the server reads as a mention) put in its place.
 */

export interface MentionQuery {
  /** Where the `@` is. */
  start: number
  /** What follows it, up to the caret. */
  query: string
}

/** The `@query` the caret ends, when the `@` starts the text or follows a space; null otherwise. */
export function getMentionQuery(text: string, caret: number): MentionQuery | null {
  const match = /(^|\s)@([^\s@]*)$/.exec(text.slice(0, caret))
  return match ? { start: caret - match[2]!.length - 1, query: match[2]! } : null
}

const fold = (value: string) => value.normalize('NFD').replace(/\p{M}/gu, '').toLowerCase()

/** The people (only `user:` actors: agents get no notifications) whose name or email has a word starting with the query, at most `limit`. */
export function getMentionCandidates<T extends { actor: string; name: string; email?: string }>(members: T[], query: string, limit = 8): T[] {
  const q = fold(query)
  return members
    .filter((member) => member.actor.startsWith('user:'))
    .filter((member) => !q || fold(`${member.name} ${member.email ?? ''}`).split(/[\s@._-]+/).some((word) => word.startsWith(q)))
    .slice(0, limit)
}

/** The text with `@query` replaced by the token and one space after it, and the caret after that space. */
export function insertMention(text: string, mention: MentionQuery, token: string): { text: string; caret: number } {
  const end = mention.start + 1 + mention.query.length
  const rest = text.slice(end)
  const inserted = `${token} `
  return { text: text.slice(0, mention.start) + inserted + rest.replace(/^ /, ''), caret: mention.start + inserted.length }
}
