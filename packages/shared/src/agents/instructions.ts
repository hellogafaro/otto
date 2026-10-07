/**
 * What Otto adds to the harness's own system prompt (Pi's is kept; this is appended after it), built as XML groups
 * like BB's `buildInstructionGroups` (docs/final-plan.md 2.6). Pure and browser-safe. Each group is left out when it
 * has nothing to say. The tag prefix is the product's name in lowercase (`otto_rules`, ...) so a rename needs no edit
 * here; `connected_mcps` keeps its name. Each Pi turn gets it through `getAgentTurn` (`agent/agent-turn.ts`).
 *
 * Order: rules (product), workspace (the `instructions` setting), agent (its own instructions), chat (the other
 * participants, only in a chat with several), tools (guidance), connected_mcps (the sources the agent may use), run
 * (unattended runs only).
 */

export type RunMode = 'attended' | 'unattended'

export type InstructionSource = { slug: string; title: string; description?: string }

export type InstructionInput = {
  product: string
  /** The product's rules, text from the harness (what Otto always does or never does). */
  rules?: string
  workspaceInstructions: string
  /** `homePath`: the agent's persistent folder; with it and no instructions the agent group is a one-line hint. */
  agent: { title: string; instructions: string; homePath?: string | null }
  /** One block of guidance per tool family, in order. */
  toolGuidance?: readonly string[]
  /** The sources the agent may use, listed so it knows what is connected (their tools are `mcp__<slug>__<tool>`). */
  sources?: readonly InstructionSource[]
  /** `unattended` for routine and background runs: nobody answers questions mid-run. Default `attended`. */
  runMode?: RunMode
  /** The chat's other participants (never this agent), given only when there are several. */
  chat?: ChatParticipants
}

/** The other people and agents of a chat, by name with their actor ('user:<id>', 'agent:<id>'), and the agent itself as `Name (agent:<id>)`. */
export type ChatParticipants = { self?: string; people: readonly { name: string; actor: string }[]; agents: readonly { name: string; actor: string }[] }

export const AGENT_HOME_ONLY_INSTRUCTION = 'Keep your notes, scripts, and reference files in your home folder; it persists across chats.'

export const UNATTENDED_RUN_INSTRUCTIONS =
  "You are operating autonomously. Nobody is watching in real time and nobody can answer questions mid-task, so asking 'Want me to...?' or 'Shall I...?' blocks the work. For reversible actions that follow from the original request, proceed without asking. A message with no tool call ends your turn and the work stops there. Do not end a turn with a summary that announces the next step instead of taking it, an offer to continue, a list of decisions that do not block the remaining work, or a report because the turn has been long. Put status notes in the same message as your next tool call and carry on with everything that does not depend on an answer. Stop only when nothing can move without a person, when something blocking you is deliberately protected from you, or before a destructive or hard-to-reverse action, which still needs confirmation. Before ending your turn, check your last paragraph: if it is a plan, a question, or a promise about work not yet done, do that work now."

function attribute(name: string, value: string): string {
  return ` ${name}="${value.replace(/&/g, '&amp;').replace(/"/g, '&quot;')}"`
}

/** A group, or null when its body is empty. */
function group(tag: string, attributes: string, body: string): string | null {
  const text = body.trim()
  return text ? `<${tag}${attributes}>\n${text}\n</${tag}>` : null
}

function agentGroup(prefix: string, agent: InstructionInput['agent']): string | null {
  const own = agent.instructions.trim()
  const home = agent.homePath?.trim() || null
  if (!own && !home) return null
  return group(`${prefix}_agent`, attribute('name', agent.title) + (home ? attribute('home', home) : ''), own || AGENT_HOME_ONLY_INSTRUCTION)
}

function sourcesGroup(sources: readonly InstructionSource[]): string | null {
  const lines = sources.map((source) => `- ${source.slug}: ${source.title}${source.description?.trim() ? ` - ${source.description.trim()}` : ''}`)
  return group('connected_mcps', '', lines.length ? `Connected MCP sources you may use (their tools are named mcp__<slug>__<tool>):\n${lines.join('\n')}` : '')
}

function chatGroup(prefix: string, chat: ChatParticipants | undefined): string | null {
  if (!chat || chat.people.length + chat.agents.length < 2) return null
  const list = (items: ChatParticipants['people']) => items.map((item) => `${item.name} (${item.actor})`).join(', ')
  return group(
    `${prefix}_chat`,
    '',
    [
      'This chat has several participants. Their messages reach you prefixed with [Name].',
      chat.self ? `You are ${chat.self}: a message with that token is addressed to you.` : '',
      chat.people.length ? `People: ${list(chat.people)}` : '',
      chat.agents.length ? `Other agents: ${list(chat.agents)}` : '',
      chat.agents.length ? 'To hand something to another agent, write its token (agent:<id>) in your reply; it answers after you.' : '',
    ]
      .filter(Boolean)
      .join('\n'),
  )
}

/** The groups joined by a blank line; '' when nothing applies. */
export function assembleInstructions(input: InstructionInput): string {
  const prefix = input.product.trim().toLowerCase().replace(/[^a-z0-9]+/g, '_').replace(/^_|_$/g, '') || 'otto'
  return [
    group(`${prefix}_rules`, '', input.rules ?? ''),
    group(`${prefix}_workspace`, '', input.workspaceInstructions),
    agentGroup(prefix, input.agent),
    chatGroup(prefix, input.chat),
    group(`${prefix}_tools`, '', (input.toolGuidance ?? []).map((text) => text.trim()).filter(Boolean).join('\n\n')),
    sourcesGroup(input.sources ?? []),
    input.runMode === 'unattended' ? group(`${prefix}_run`, attribute('mode', 'unattended'), UNATTENDED_RUN_INSTRUCTIONS) : null,
  ]
    .filter((text): text is string => text !== null)
    .join('\n\n')
}
