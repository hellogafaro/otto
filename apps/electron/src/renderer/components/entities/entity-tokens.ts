/**
 * Typed references in text (`user:<id>`, `task:<id>`, `agent:<id>`, ...; `ENTITY_TOKEN`, shared with the server's mention
 * finder) and what they point at. Pure, so the chip, the comment text and the notifications share one reading:
 * the token stays plain in storage and its title is looked up when it is drawn, so a rename shows everywhere.
 */

import { ENTITY_TOKEN } from '@otto/shared/entities'
import { routes } from '../../../shared/routes'
import type { Agent, LibraryItem } from '../../../shared/types'
import { getDisplayTitle } from '../../pages/library/library-items'

export type EntityType = 'user' | 'task' | 'project' | 'library' | 'agent' | 'comment'

/** The loaded lists a title is read from; a list is null until it has loaded. */
export interface EntityLists {
  members: { actor: string; name: string; email?: string; me?: true }[] | null
  tasks: { id: string; title: string }[] | null
  projects: { id: string; title: string }[] | null
  library: Pick<LibraryItem, 'id' | 'type' | 'title'>[] | null
  agents: Pick<Agent, 'id' | 'title' | 'avatar'>[] | null
}

export interface EntityInfo {
  type: EntityType
  id: string
  /** The live title (a person's name); null while its list loads or when it is gone (`missing`). */
  title: string | null
  missing: boolean
  /** The route that opens it; null for a person and for a comment (no page of its own). */
  route: string | null
}

/** The type and id of a `<type>:<id>` reference; null for anything else. */
export function parseEntity(entity: string): { type: EntityType; id: string } | null {
  const match = [...entity.matchAll(ENTITY_TOKEN)][0]
  return match && match[0] === entity ? { type: match[1] as EntityType, id: match[2]! } : null
}

export function describeEntity(entity: string, lists: EntityLists): EntityInfo | null {
  const parsed = parseEntity(entity)
  if (!parsed) return null
  const { type, id } = parsed
  const found = (list: { id: string; title: string }[] | null, title = (item: { id: string; title: string }) => item.title) => {
    if (!list) return { title: null, missing: false }
    const item = list.find((entry) => entry.id === id)
    return { title: item ? title(item) : null, missing: !item }
  }
  switch (type) {
    case 'user': {
      if (!lists.members) return { type, id, title: null, missing: false, route: null }
      const member = lists.members.find((entry) => entry.actor === entity)
      return { type, id, title: member ? member.name || member.email || null : null, missing: !member, route: null }
    }
    case 'task':
      return { type, id, ...found(lists.tasks), route: routes.view.tasks({ taskId: id }) }
    case 'project':
      return { type, id, ...found(lists.projects), route: routes.view.projects({ projectId: id }) }
    case 'library':
      return { type, id, ...found(lists.library, (item) => getDisplayTitle(item as LibraryItem)), route: routes.view.library({ itemId: id }) }
    case 'agent':
      return { type, id, ...found(lists.agents), route: routes.view.agents(id) }
    case 'comment':
      // No reader resolves a comment id to what it is on yet; a notification opens `comment.entity` instead.
      return { type, id, title: null, missing: false, route: null }
  }
}

/** Code (fenced blocks and inline spans) is left as typed: a token in it stays text. */
const CODE = /(```[\s\S]*?(?:```|$)|`[^`\n]*`)/g

/** Text and tokens in order, for drawing: `{ text }` runs and `{ entity }` references (code included as text). */
export function splitEntityTokens(content: string): ({ text: string } | { entity: string })[] {
  const parts: ({ text: string } | { entity: string })[] = []
  const push = (text: string) => {
    if (!text) return
    const last = parts.at(-1)
    if (last && 'text' in last) last.text += text
    else parts.push({ text })
  }
  content.split(CODE).forEach((chunk, index) => {
    if (index % 2 === 1) return push(chunk)
    let at = 0
    for (const match of chunk.matchAll(ENTITY_TOKEN)) {
      push(chunk.slice(at, match.index))
      parts.push({ entity: match[0] })
      at = match.index! + match[0].length
    }
    push(chunk.slice(at))
  })
  return parts
}

/** The markdown with each token (outside code) as an empty `<span data-entity>`, which the renderer draws as a chip. */
export function toEntityMarkdown(content: string): string {
  return splitEntityTokens(content)
    .map((part) => ('entity' in part ? `<span data-entity="${part.entity}"></span>` : part.text))
    .join('')
}

/** One line of plain text (an excerpt): tokens become `label(token)`, emphasis, code and heading marks go, whitespace collapses. */
export function plainEntityText(content: string, label: (entity: string) => string): string {
  return splitEntityTokens(content)
    .map((part) => ('entity' in part ? label(part.entity) : part.text.replace(/[*~`]+|^\s*(?:#+|>)\s*/gm, '')))
    .join('')
    .replace(/\s+/g, ' ')
    .trim()
}
