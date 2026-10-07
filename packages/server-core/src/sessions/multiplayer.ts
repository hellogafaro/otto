import { ENTITY_TOKEN } from '@otto/shared/entities'
import type { ChatLogRow } from '@otto/shared/sessions'

/**
 * Multiplayer chats (docs/final-plan.md 2.3 "Multiplayer"): which agents a message wakes, and what an agent is given
 * at the start of its turn. Pure; the session manager runs the turns, one per chat at a time.
 */

/** How many agent replies in a row agents may wake by mentioning each other (the human message is depth 0). */
export const MAX_AGENT_CHAIN_DEPTH = 3
/** How many agent turns one human message may lead to in a chat, mentions and chains together. */
export const MAX_AGENT_TURNS = 8
/** What an agent new to a chat is given of the history (its newest messages). Shortcut: older context is left out. */
export const NEW_AGENT_HISTORY = 40

/** The agent ids mentioned in a text (`agent:<id>` tokens) that are in `known`, in mention order, once each. */
export function mentionedAgents(text: string, known: ReadonlySet<string>): string[] {
  const ids: string[] = []
  for (const match of text.matchAll(ENTITY_TOKEN)) {
    if (match[1] === 'agent' && known.has(match[2]!) && !ids.includes(match[2]!)) ids.push(match[2]!)
  }
  return ids
}

const mentionsPeople = (text: string) => [...text.matchAll(ENTITY_TOKEN)].some((match) => match[1] === 'user')

/**
 * The agents a person's message wakes, in order: the agents it mentions; with none, the primary agent when the chat
 * has one person (and the message mentions no one else); otherwise none (people are talking to each other).
 */
export function routeMessage(input: { text: string; people: number; primaryAgentId?: string; agents: ReadonlySet<string> }): string[] {
  const mentioned = mentionedAgents(input.text, input.agents)
  if (mentioned.length) return mentioned
  if (mentionsPeople(input.text)) return []
  return input.people <= 1 && input.primaryAgentId ? [input.primaryAgentId] : []
}

/** The agents an agent's reply hands work to: those it mentions, never itself. */
export function routeAgentReply(text: string, selfId: string, agents: ReadonlySet<string>): string[] {
  return mentionedAgents(text, agents).filter((id) => id !== selfId)
}

/** Who wrote a row: a user row its `sender` (older ones: the creator), an assistant row its `author` (older ones: the primary agent). */
export function authorOfRow(row: Pick<ChatLogRow, 'type' | 'sender' | 'author'>, chat: { createdBy?: string; primaryAgentId?: string }): string | undefined {
  if (row.type === 'user') return row.sender ?? chat.createdBy
  return row.author ?? (chat.primaryAgentId ? `agent:${chat.primaryAgentId}` : undefined)
}

/**
 * What an agent's turn sends Pi (each agent has its own session): the rows it has not been given (`unseen`, oldest
 * first) as user text, its own replies left out (they are in its session already), each prefixed `[<name>]` when the
 * chat has more than one author besides it. `current` is the message this turn answers (its rows are `currentIds`;
 * none for a turn another agent's mention woke): its text is sent as given, so a chat of one person and one agent sends
 * exactly that message, as before multiplayer.
 */
export function buildAgentPrompt(input: {
  agentId: string
  unseen: readonly ChatLogRow[]
  current?: { ids: readonly string[]; text: string; author?: string }
  chat: { createdBy?: string; primaryAgentId?: string }
  prefix: boolean
  nameOf: (actor: string) => string
}): string {
  const self = `agent:${input.agentId}`
  const current = new Set(input.current?.ids ?? [])
  const line = (author: string | undefined, text: string) => (input.prefix && author ? `[${input.nameOf(author)}] ${text}` : text)
  const parts: string[] = []
  for (const row of input.unseen) {
    if (current.has(row.id) || row.hidden || row.intermediate || !row.text?.trim()) continue
    const author = authorOfRow(row, input.chat)
    if (author === self) continue
    parts.push(line(author, row.text))
  }
  if (input.current) parts.push(line(input.current.author, input.current.text))
  return parts.join('\n\n')
}

/** Whether a chat has more than one author besides the agent (then every message it is given names its author). */
export function hasSeveralAuthors(authors: Iterable<string | undefined>, agentId: string): boolean {
  const others = new Set<string>()
  for (const author of authors) if (author && author !== `agent:${agentId}`) others.add(author)
  return others.size > 1
}
