import { and, asc, eq } from 'drizzle-orm'
import { THINKING_LEVEL_IDS, type ThinkingLevel } from '../agent/thinking-levels.ts'
import { userActor } from '../actors.ts'
import { AGENT_DEFAULT_NAME, PRODUCT_NAME } from '../branding.ts'
import { getDefaultConnection } from '../connections/index.ts'
import { initDb, type Db, type Tx } from '../db/index.ts'
import { createId } from '../id.ts'
import { getSetting, workspaceEntity } from '../settings/index.ts'
import { domainError } from '../utils/errors.ts'
import { getMemberRole } from '../workspaces/members.ts'
import { assembleInstructions } from './instructions.ts'
import { agents } from './schema.ts'
import { clearChatsAgent, notifyChatsChange } from '../sessions/chats.ts'
import {
  AVATAR_REF,
  FALLBACK_PROVIDER,
  MAX_INSTRUCTIONS,
  MAX_LIST,
  MAX_TITLE,
  type Agent,
  type AgentInput,
  type AgentRunConfig,
  type AgentUpdate,
} from './types.ts'

/**
 * Agents: who a chat talks to, one table (docs/final-plan.md 2.7, docs/schema.md).
 *
 *   agents(id, workspace_id, title, instructions, provider, model, thinking_level, skills, sources,
 *          avatar, created_by, created_at, updated_at)                                         (schema.ts)
 *
 * `provider` names which of the chat creator's connections pays (never an account); `model` null = that
 * connection's default; `skills` and `sources` are id lists, `[]` = all. The workspace's default agent is its
 * oldest; the last agent cannot be deleted, so a workspace that has been seeded always has one. Chats name their
 * agent in the session header (`agentId`, absent = the default); one that was deleted falls back to the default
 * the same way (`getAgentRunConfig`), so deleting never rewrites a chat. Every function takes the workspace
 * explicitly and only sees its rows. Who may edit is `canEditAgent`, applied by the guard (`bootstrap/authorize.ts`)
 * (for the app and the agents' `otto` CLI alike); these functions do not know users.
 */

export * from './instructions.ts'
export * from './types.ts'

type Row = typeof agents.$inferSelect

const toAgent = (row: Row, defaultId: string | undefined): Agent => ({
  id: row.id,
  title: row.title,
  instructions: row.instructions,
  provider: row.provider,
  model: row.model,
  thinkingLevel: row.thinkingLevel as ThinkingLevel,
  skills: row.skills,
  sources: row.sources,
  avatar: row.avatar,
  createdBy: row.createdBy,
  createdAt: row.createdAt.getTime(),
  updatedAt: row.updatedAt.getTime(),
  isDefault: row.id === defaultId,
})

function assertTitle(title: unknown): string {
  if (typeof title !== 'string' || !title.trim()) throw domainError('invalid', 'A name is required')
  if (title.trim().length > MAX_TITLE) throw domainError('invalid', `Names are limited to ${MAX_TITLE} characters`)
  return title.trim()
}

function assertText(value: unknown, name: string, max: number): string {
  if (typeof value !== 'string') throw domainError('invalid', `${name} must be text`)
  if (value.length > max) throw domainError('invalid', `${name} is limited to ${max} characters`)
  return value
}

function assertProvider(provider: unknown): string {
  if (typeof provider !== 'string' || !provider.trim() || provider.length > 100) throw domainError('invalid', 'A provider is required')
  return provider.trim()
}

function assertModel(model: unknown): string | null {
  if (model === null || model === '') return null
  if (typeof model !== 'string' || model.length > 200) throw domainError('invalid', 'The model must be text or null')
  return model
}

function assertThinkingLevel(level: unknown): ThinkingLevel {
  if (!(THINKING_LEVEL_IDS as readonly unknown[]).includes(level)) throw domainError('invalid', `The thinking level is one of ${THINKING_LEVEL_IDS.join(', ')}`)
  return level as ThinkingLevel
}

function assertIds(ids: unknown, name: string): string[] {
  if (!Array.isArray(ids) || ids.some((id) => typeof id !== 'string' || !id || id.length > 200)) throw domainError('invalid', `${name} must be a list of ids`)
  const unique = [...new Set(ids as string[])]
  if (unique.length > MAX_LIST) throw domainError('invalid', `At most ${MAX_LIST} ${name}`)
  return unique
}

function assertAvatar(avatar: unknown): string {
  if (avatar === '' || (typeof avatar === 'string' && AVATAR_REF.test(avatar))) return avatar
  throw domainError('invalid', 'The avatar is empty or library:<id> of an image')
}

function assertCreator(createdBy: unknown): string {
  if (typeof createdBy !== 'string' || !createdBy) throw domainError('invalid', 'An agent needs its creator')
  return createdBy
}

const oldestFirst = [asc(agents.createdAt), asc(agents.id)] as const

function rowsOf(workspaceId: string, db: Db | Tx): Row[] {
  return db.select().from(agents).where(eq(agents.workspaceId, workspaceId)).orderBy(...oldestFirst).all()
}

/** The workspace's agents, the oldest (the default) first. */
export function getAgents(workspaceId: string, db: Db | Tx = initDb()): Agent[] {
  const rows = rowsOf(workspaceId, db)
  return rows.map((row) => toAgent(row, rows[0]?.id))
}

export function getAgent(workspaceId: string, id: string, db: Db | Tx = initDb()): Agent | undefined {
  return getAgents(workspaceId, db).find((agent) => agent.id === id)
}

/** The workspace's oldest agent; undefined only before `initAgentsSeed` ran for it. */
export function getDefaultAgent(workspaceId: string, db: Db | Tx = initDb()): Agent | undefined {
  return getAgents(workspaceId, db)[0]
}

export function createAgent(input: AgentInput, db: Db | Tx = initDb()): Agent {
  const title = assertTitle(input.title)
  const values = {
    id: createId(),
    workspaceId: input.workspaceId,
    title,
    instructions: assertText(input.instructions ?? '', 'The instructions', MAX_INSTRUCTIONS),
    provider: assertProvider(input.provider),
    model: assertModel(input.model ?? null),
    thinkingLevel: assertThinkingLevel(input.thinkingLevel ?? 'medium'),
    skills: assertIds(input.skills ?? [], 'skills'),
    sources: assertIds(input.sources ?? [], 'sources'),
    avatar: assertAvatar(input.avatar ?? ''),
    createdBy: assertCreator(input.createdBy),
  }
  return db.transaction((tx) => {
    // Strictly after the workspace's newest agent, so "the oldest" never ties with one made in the same millisecond.
    const newest = rowsOf(input.workspaceId, tx).at(-1)
    const createdAt = new Date(Math.max(Date.now(), (newest?.createdAt.getTime() ?? 0) + 1))
    const row = tx.insert(agents).values({ ...values, createdAt, updatedAt: createdAt }).returning().get()
    return toAgent(row, rowsOf(input.workspaceId, tx)[0]!.id)
  })
}

/**
 * Changes the given fields (`skills` and `sources` replace their lists, `model: null` clears the model). With
 * `expectedUpdatedAt`, a different stored `updatedAt` means someone saved in between, and nothing changes (`conflict`).
 */
export function updateAgent(workspaceId: string, id: string, patch: AgentUpdate, db: Db | Tx = initDb()): Agent {
  return db.transaction((tx) => {
    const rows = rowsOf(workspaceId, tx)
    const row = rows.find((candidate) => candidate.id === id)
    if (!row) throw domainError('not_found', `Agent ${id} does not exist`)
    if (patch.expectedUpdatedAt !== undefined && patch.expectedUpdatedAt !== row.updatedAt.getTime()) {
      throw domainError('conflict', `Agent ${id} changed since it was loaded`)
    }
    const changes: Partial<Row> = {}
    if (patch.title !== undefined) changes.title = assertTitle(patch.title)
    if (patch.instructions !== undefined) changes.instructions = assertText(patch.instructions, 'The instructions', MAX_INSTRUCTIONS)
    if (patch.provider !== undefined) changes.provider = assertProvider(patch.provider)
    if (patch.model !== undefined) changes.model = assertModel(patch.model)
    if (patch.thinkingLevel !== undefined) changes.thinkingLevel = assertThinkingLevel(patch.thinkingLevel)
    if (patch.skills !== undefined) changes.skills = assertIds(patch.skills, 'skills')
    if (patch.sources !== undefined) changes.sources = assertIds(patch.sources, 'sources')
    if (patch.avatar !== undefined) changes.avatar = assertAvatar(patch.avatar)
    // Strictly after the stored value, so two saves in one millisecond still tell apart.
    const updated = tx
      .update(agents)
      .set({ ...changes, updatedAt: new Date(Math.max(Date.now(), row.updatedAt.getTime() + 1)) })
      .where(and(eq(agents.workspaceId, workspaceId), eq(agents.id, id)))
      .returning()
      .get()
    return toAgent(updated, rows[0]!.id)
  })
}

/**
 * Removes an agent. The last one of a workspace cannot go (`invalid`). Its chats move to the workspace's default
 * agent (`chats.agent_id` null) in the same transaction, and the session manager hears of it.
 */
export function deleteAgent(workspaceId: string, id: string, db: Db | Tx = initDb()): void {
  const moved = db.transaction((tx) => {
    const rows = rowsOf(workspaceId, tx)
    if (!rows.some((row) => row.id === id)) throw domainError('not_found', `Agent ${id} does not exist`)
    if (rows.length === 1) throw domainError('invalid', 'The last agent of a workspace cannot be deleted')
    tx.delete(agents).where(and(eq(agents.workspaceId, workspaceId), eq(agents.id, id))).run()
    return clearChatsAgent(tx, workspaceId, id)
  })
  notifyChatsChange(workspaceId, moved)
}

/**
 * Gives the workspace its first agent (title `AGENT_DEFAULT_NAME`) unless it has one: at workspace creation, from the
 * importer, and at first use (`agents:list`). Returns the agent that was made, undefined when there already was one.
 */
export function initAgentsSeed(workspaceId: string, createdBy: string, provider: string = FALLBACK_PROVIDER, db: Db | Tx = initDb()): Agent | undefined {
  return db.transaction((tx) => (rowsOf(workspaceId, tx).length ? undefined : createAgent({ workspaceId, title: AGENT_DEFAULT_NAME, provider, createdBy }, tx)))
}

/** The provider a person's new agent starts with: the Pi provider of their default connection (`FALLBACK_PROVIDER` with none). */
export function getDefaultProvider(workspaceId: string, userId: string | null): string {
  return getDefaultConnection({ workspaceId, userId })?.type ?? FALLBACK_PROVIDER
}

/** The workspace's `instructions` setting: text every agent of it gets before its own. */
export const getWorkspaceInstructions = (workspaceId: string, db: Db | Tx = initDb()): string => getSetting(workspaceEntity(workspaceId), 'instructions', db)

/** Whether a person may edit or delete an agent: its creator, or an owner of its workspace. */
export function canEditAgent(workspaceId: string, agent: Pick<Agent, 'createdBy'>, userId: string, db: Db | Tx = initDb()): boolean {
  return agent.createdBy === userActor(userId) || getMemberRole(workspaceId, userId, db) === 'owner'
}

/**
 * What a turn takes from an agent: `Turn.agent`, `Turn.instructions` (workspace instructions then the agent's,
 * assembled), `Turn.model` and thinking level, and the skill and source id lists (`[]` = all). `agentId` is the chat's
 * header `agentId`; absent, or an agent that was deleted, gives the default agent of `workspaceId`. Undefined when
 * neither exists (an unseeded workspace). Reads only.
 * Read per turn by `getAgentTurn` (`agent/agent-turn.ts`) and, for the provider and model, by the session's
 * connection resolution (`resolveBackendContext`).
 */
export function getAgentRunConfig(agentId: string | null | undefined, workspaceId?: string, db: Db | Tx = initDb()): AgentRunConfig | undefined {
  const named = agentId ? db.select().from(agents).where(eq(agents.id, agentId)).get() : undefined
  const row = named && (!workspaceId || named.workspaceId === workspaceId) ? named : workspaceId ? rowsOf(workspaceId, db)[0] : undefined
  if (!row) return undefined
  const workspaceInstructions = getWorkspaceInstructions(row.workspaceId, db)
  const agent = toAgent(row, undefined)
  return {
    agent: { id: agent.id, title: agent.title },
    instructions: assembleInstructions({ product: PRODUCT_NAME, workspaceInstructions, agent: { title: agent.title, instructions: agent.instructions } }),
    workspaceInstructions,
    agentInstructions: agent.instructions,
    provider: agent.provider,
    model: agent.model,
    thinkingLevel: agent.thinkingLevel,
    skills: agent.skills,
    sources: agent.sources,
  }
}
