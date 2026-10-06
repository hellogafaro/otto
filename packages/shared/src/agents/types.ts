import type { ThinkingLevel } from '../agent/thinking-levels.ts'

/** The limits and pickers of an agent, browser-safe (the renderer validates with the same numbers). */
export const MAX_TITLE = 80
export const MAX_INSTRUCTIONS = 20_000
export const MAX_LIST = 200
/** An avatar is empty (a generated one, derived from the agent id) or `library:<id>` of an uploaded image. */
export const AVATAR_REF = /^library:[0-9a-z]{12}$/
/** Where a provider comes from when its creator has no connection yet. */
export const FALLBACK_PROVIDER = 'anthropic'

export type AgentErrorCode = 'invalid' | 'not_found' | 'conflict'

/** What the agents domain hands out. `skills` and `sources` are id lists, `[]` = all. `isDefault` marks the workspace's oldest agent. */
export type Agent = {
  id: string
  title: string
  instructions: string
  provider: string
  model: string | null
  thinkingLevel: ThinkingLevel
  skills: string[]
  sources: string[]
  avatar: string
  createdBy: string
  createdAt: number
  updatedAt: number
  isDefault: boolean
}

export type AgentInput = {
  workspaceId: string
  title: string
  instructions?: string
  provider: string
  model?: string | null
  thinkingLevel?: ThinkingLevel
  skills?: string[]
  sources?: string[]
  /** Left out or empty: a generated avatar. */
  avatar?: string
  createdBy: string
}

/** `expectedUpdatedAt` is the `updatedAt` the caller last saw; a different stored value is a `conflict`. */
export type AgentUpdate = Partial<Omit<AgentInput, 'workspaceId' | 'createdBy'>> & { expectedUpdatedAt?: number }

/** What a turn takes from an agent (see `getAgentRunConfig`). `instructions` is assembled, never a file. */
export type AgentRunConfig = {
  agent: { id: string; title: string }
  /** `workspaceInstructions` + the agent's own, assembled with no rules, tools, sources or run mode; the harness assembles the full text itself from the two raw parts. */
  instructions: string
  workspaceInstructions: string
  agentInstructions: string
  provider: string
  model: string | null
  thinkingLevel: ThinkingLevel
  skills: string[]
  sources: string[]
}
